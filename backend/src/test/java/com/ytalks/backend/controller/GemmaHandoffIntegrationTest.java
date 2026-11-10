package com.ytalks.backend.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ytalks.backend.entity.Message;
import com.ytalks.backend.entity.SenderType;
import com.ytalks.backend.entity.User;
import com.ytalks.backend.exception.ApiException;
import com.ytalks.backend.security.JwtService;
import com.ytalks.backend.service.GeminiService;
import com.ytalks.backend.service.OpenRouterService;
import com.ytalks.backend.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.is;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Real controller + real ConversationService + real database (H2 in MySQL mode),
 * with both AI providers mocked. Verifies the Gemini -> Gemma handoff and persistence.
 */
@SpringBootTest
@AutoConfigureMockMvc
class GemmaHandoffIntegrationTest {

    private static final String GEMMA_MODEL = "google/gemma-4-26b-a4b-it:free";

    @Autowired private MockMvc mockMvc;
    @Autowired private JwtService jwtService;
    @Autowired private UserService userService;
    private final ObjectMapper mapper = new ObjectMapper();

    @MockitoBean private GeminiService geminiService;
    @MockitoBean private OpenRouterService openRouterService;

    private String token;

    @BeforeEach
    void setUp() {
        User user = userService.findByEmail("aarav.sharma@example.com").orElseThrow();
        token = jwtService.generateToken(user.getId());
        when(geminiService.isConfigured()).thenReturn(true);
        when(geminiService.getModel()).thenReturn("gemini-test-model");
        when(openRouterService.isConfigured()).thenReturn(true);
        when(openRouterService.getModel()).thenReturn(GEMMA_MODEL);
    }

    private long createConversation(String provider, String model) throws Exception {
        String body = mapper.writeValueAsString(java.util.Map.of("title", "Handoff test", "providerId", provider, "model", model));
        String res = mockMvc.perform(post("/api/conversations").header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return mapper.readTree(res).path("id").asLong();
    }

    private void chat(long id, String provider, String text) throws Exception {
        String body = mapper.writeValueAsString(java.util.Map.of("message", text, "providerId", provider));
        mockMvc.perform(post("/api/chat/" + id + "/messages").header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.providerId", is(provider)));
    }

    private JsonNode detail(long id) throws Exception {
        String res = mockMvc.perform(get("/api/conversations/" + id).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return mapper.readTree(res);
    }

    @Test
    @DisplayName("GET /api/chat/providers lists Gemma 4 (OpenRouter) with its exact model and configured status")
    void providersIncludeGemma() throws Exception {
        mockMvc.perform(get("/api/chat/providers"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id", is("gemini")))
                .andExpect(jsonPath("$[4].id", is("gemma")))
                .andExpect(jsonPath("$[4].name", is("Gemma 4 (OpenRouter)")))
                .andExpect(jsonPath("$[4].defaultModel", is(GEMMA_MODEL)))
                .andExpect(jsonPath("$[4].implemented", is(true)));
    }

    @Test
    @DisplayName("Gemini -> Gemma handoff: Gemma receives saved Gemini history; all messages persist in order with provider/model")
    void geminiToGemmaHandoffAndPersistence() throws Exception {
        long id = createConversation("gemini", "gemini-test-model");
        when(geminiService.sendMessage(anyList())).thenReturn("Gemini: ML learns from data.");
        chat(id, "gemini", "Explain machine learning.");

        // Switch the same conversation to Gemma (YES path) and ask a follow-up
        when(openRouterService.sendMessage(anyList())).thenReturn("Gemma: building on that, here is an example.");
        chat(id, "gemma", "Give me an example.");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Message>> captor = ArgumentCaptor.forClass(List.class);
        verify(openRouterService).sendMessage(captor.capture());
        List<Message> sent = captor.getValue();
        assertThat(sent).extracting(Message::getContent).containsExactly(
                "Explain machine learning.", "Gemini: ML learns from data.", "Give me an example.");
        assertThat(sent).extracting(Message::getSenderType)
                .containsExactly(SenderType.USER, SenderType.ASSISTANT, SenderType.USER);

        // "Browser refresh": reload the full conversation from the database
        JsonNode messages = detail(id).path("messages");
        assertThat(messages).hasSize(4);
        assertThat(messages.get(1).path("providerId").asText()).isEqualTo("gemini");
        assertThat(messages.get(1).path("model").asText()).isEqualTo("gemini-test-model");
        assertThat(messages.get(3).path("senderType").asText()).isEqualTo("ASSISTANT");
        assertThat(messages.get(3).path("providerId").asText()).isEqualTo("gemma");
        assertThat(messages.get(3).path("model").asText()).isEqualTo(GEMMA_MODEL);
        assertThat(messages.get(3).path("content").asText()).startsWith("Gemma:");
    }

    @Test
    @DisplayName("Starting a NEW Gemma conversation sends no previous context and leaves the original untouched")
    void newConversationWithoutContext() throws Exception {
        long original = createConversation("gemini", "gemini-test-model");
        when(geminiService.sendMessage(anyList())).thenReturn("Gemini original answer");
        chat(original, "gemini", "Original question");

        long fresh = createConversation("gemma", GEMMA_MODEL);
        when(openRouterService.sendMessage(anyList())).thenReturn("Gemma fresh answer");
        chat(fresh, "gemma", "Brand new question");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Message>> captor = ArgumentCaptor.forClass(List.class);
        verify(openRouterService).sendMessage(captor.capture());
        assertThat(captor.getValue()).extracting(Message::getContent).containsExactly("Brand new question");

        assertThat(detail(original).path("messages")).hasSize(2);
        assertThat(detail(fresh).path("messages")).hasSize(2);
    }

    @Test
    @DisplayName("Retrying a failed Gemma request does not duplicate the saved user message")
    void retryDoesNotDuplicate() throws Exception {
        long id = createConversation("gemma", GEMMA_MODEL);
        when(openRouterService.sendMessage(anyList()))
                .thenThrow(new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "OPENROUTER_UNAVAILABLE", "down"))
                .thenReturn("Recovered");

        String body = mapper.writeValueAsString(java.util.Map.of("message", "Hello", "providerId", "gemma"));
        mockMvc.perform(post("/api/chat/" + id + "/messages").header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code", is("OPENROUTER_UNAVAILABLE")));
        chat(id, "gemma", "Hello");

        JsonNode messages = detail(id).path("messages");
        assertThat(messages).hasSize(2);
        assertThat(messages.get(0).path("senderType").asText()).isEqualTo("USER");
        assertThat(messages.get(1).path("content").asText()).isEqualTo("Recovered");
    }

    @Test
    @DisplayName("Gemma without OPENROUTER_API_KEY returns 503 OPENROUTER_NOT_CONFIGURED and saves nothing as a reply")
    void gemmaNotConfigured() throws Exception {
        when(openRouterService.isConfigured()).thenReturn(false);
        long id = createConversation("gemma", GEMMA_MODEL);
        String body = mapper.writeValueAsString(java.util.Map.of("message", "Hello", "providerId", "gemma"));
        mockMvc.perform(post("/api/chat/" + id + "/messages").header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code", is("OPENROUTER_NOT_CONFIGURED")));
        verify(openRouterService, never()).sendMessage(anyList());
        assertThat(detail(id).path("messages")).isEmpty();
    }
}
