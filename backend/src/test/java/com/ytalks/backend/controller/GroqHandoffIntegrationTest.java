package com.ytalks.backend.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.types.Content;
import com.ytalks.backend.entity.Message;
import com.ytalks.backend.entity.SenderType;
import com.ytalks.backend.entity.User;
import com.ytalks.backend.exception.ApiException;
import com.ytalks.backend.security.JwtService;
import com.ytalks.backend.service.GeminiService;
import com.ytalks.backend.service.GroqService;
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
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.is;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * End-to-end integration tests for Cross-Model Gemini <-> Groq continuity
 * using real Controller, real ConversationService, and real database (H2 in MySQL mode).
 */
@SpringBootTest
@AutoConfigureMockMvc
class GroqHandoffIntegrationTest {

    private static final String GROQ_MODEL = "openai/gpt-oss-20b";
    private static final String GEMINI_MODEL = "gemini-3.5-flash-lite";

    @Autowired private MockMvc mockMvc;
    @Autowired private JwtService jwtService;
    @Autowired private UserService userService;
    private final ObjectMapper mapper = new ObjectMapper();

    @MockitoBean private GeminiService geminiService;
    @MockitoBean private GroqService groqService;

    private String token;

    @BeforeEach
    void setUp() {
        User user = userService.findByEmail("aarav.sharma@example.com").orElseThrow();
        token = jwtService.generateToken(user.getId());
        when(geminiService.isConfigured()).thenReturn(true);
        when(geminiService.getModel()).thenReturn(GEMINI_MODEL);
        when(groqService.isConfigured()).thenReturn(true);
        when(groqService.getModel()).thenReturn(GROQ_MODEL);
    }

    private long createConversation(String provider, String model) throws Exception {
        String body = mapper.writeValueAsString(Map.of("title", "ML Discussion", "providerId", provider, "model", model));
        String res = mockMvc.perform(post("/api/conversations")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return mapper.readTree(res).path("id").asLong();
    }

    private void chat(long id, String provider, String text) throws Exception {
        String body = mapper.writeValueAsString(Map.of("message", text, "providerId", provider));
        mockMvc.perform(post("/api/chat/" + id + "/messages")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.providerId", is(provider)));
    }

    private JsonNode getConversationDetail(long id) throws Exception {
        String res = mockMvc.perform(get("/api/conversations/" + id)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return mapper.readTree(res);
    }

    @Test
    @DisplayName("GET /api/chat/providers lists Groq with configured model and implemented=true")
    void providersIncludeGroq() throws Exception {
        mockMvc.perform(get("/api/chat/providers"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id", is("gemini")))
                .andExpect(jsonPath("$[5].id", is("groq")))
                .andExpect(jsonPath("$[5].name", is("Groq")))
                .andExpect(jsonPath("$[5].defaultModel", is(GROQ_MODEL)))
                .andExpect(jsonPath("$[5].implemented", is(true)));
    }

    @Test
    @DisplayName("Full Roundtrip: Gemini -> Groq -> Gemini shared history continuity in database")
    void fullCrossModelContinuity() throws Exception {
        // STEP 1: User starts conversation with Gemini
        long convId = createConversation("gemini", GEMINI_MODEL);
        when(geminiService.sendMessage(anyList())).thenReturn("Gemini: Machine learning is data-driven computing.");
        chat(convId, "gemini", "Explain Machine Learning.");

        // STEP 2 & 3: User continues conversation with Groq (YES path)
        when(groqService.sendMessage(anyList())).thenReturn("Groq: Building on what Gemini said, ML applications include vision and NLP.");
        chat(convId, "groq", "Now explain the importance and applications of Machine Learning.");

        // Verify Groq received the previous Gemini conversation as context
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Message>> groqCaptor = ArgumentCaptor.forClass(List.class);
        verify(groqService).sendMessage(groqCaptor.capture());
        List<Message> groqInput = groqCaptor.getValue();
        assertThat(groqInput).extracting(Message::getContent).containsExactly(
                "Explain Machine Learning.",
                "Gemini: Machine learning is data-driven computing.",
                "Now explain the importance and applications of Machine Learning."
        );
        assertThat(groqInput).extracting(Message::getSenderType).containsExactly(
                SenderType.USER, SenderType.ASSISTANT, SenderType.USER
        );

        // STEP 4: User switches back to Gemini and continues
        when(geminiService.sendMessage(anyList())).thenReturn("Gemini: To summarize both explanations, ML is foundational.");
        chat(convId, "gemini", "Can you summarize both of your points?");

        // Verify Gemini received the entire chain including Groq's assistant message
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Message>> geminiCaptor = ArgumentCaptor.forClass(List.class);
        verify(geminiService, times(2)).sendMessage(geminiCaptor.capture());
        List<Message> geminiSecondInput = geminiCaptor.getAllValues().get(1);
        assertThat(geminiSecondInput).extracting(Message::getContent).contains(
                "Explain Machine Learning.",
                "Gemini: Machine learning is data-driven computing.",
                "Now explain the importance and applications of Machine Learning.",
                "Groq: Building on what Gemini said, ML applications include vision and NLP.",
                "Can you summarize both of your points?"
        );

        // STEP 5: Browser refresh / full reload from MySQL
        JsonNode messages = getConversationDetail(convId).path("messages");
        assertThat(messages).hasSize(6);

        // Verify each message retains its original role, provider, model and sequence
        assertThat(messages.get(0).path("senderType").asText()).isEqualTo("USER");
        assertThat(messages.get(0).path("content").asText()).isEqualTo("Explain Machine Learning.");

        assertThat(messages.get(1).path("senderType").asText()).isEqualTo("ASSISTANT");
        assertThat(messages.get(1).path("providerId").asText()).isEqualTo("gemini");
        assertThat(messages.get(1).path("model").asText()).isEqualTo(GEMINI_MODEL);

        assertThat(messages.get(2).path("senderType").asText()).isEqualTo("USER");
        assertThat(messages.get(2).path("content").asText()).isEqualTo("Now explain the importance and applications of Machine Learning.");

        assertThat(messages.get(3).path("senderType").asText()).isEqualTo("ASSISTANT");
        assertThat(messages.get(3).path("providerId").asText()).isEqualTo("groq");
        assertThat(messages.get(3).path("model").asText()).isEqualTo(GROQ_MODEL);

        assertThat(messages.get(4).path("senderType").asText()).isEqualTo("USER");
        assertThat(messages.get(5).path("senderType").asText()).isEqualTo("ASSISTANT");
        assertThat(messages.get(5).path("providerId").asText()).isEqualTo("gemini");
    }

    @Test
    @DisplayName("Starting fresh with Groq (NO path) isolates context without deleting original conversation")
    void startFreshDoesNotSendPreviousContext() throws Exception {
        long originalConv = createConversation("gemini", GEMINI_MODEL);
        when(geminiService.sendMessage(anyList())).thenReturn("Gemini explanation.");
        chat(originalConv, "gemini", "Gemini question");

        // Fresh conversation for Groq
        long freshConv = createConversation("groq", GROQ_MODEL);
        when(groqService.sendMessage(anyList())).thenReturn("Groq fresh explanation.");
        chat(freshConv, "groq", "Brand new question for Groq");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Message>> captor = ArgumentCaptor.forClass(List.class);
        verify(groqService).sendMessage(captor.capture());
        assertThat(captor.getValue()).extracting(Message::getContent).containsExactly("Brand new question for Groq");

        // Original conversation still has its messages
        assertThat(getConversationDetail(originalConv).path("messages")).hasSize(2);
        assertThat(getConversationDetail(freshConv).path("messages")).hasSize(2);
    }

    @Test
    @DisplayName("Retrying a failed Groq request does not duplicate the saved user message")
    void retryDoesNotDuplicateUserMessage() throws Exception {
        long convId = createConversation("groq", GROQ_MODEL);
        when(groqService.sendMessage(anyList()))
                .thenThrow(new ApiException(HttpStatus.TOO_MANY_REQUESTS, "GROQ_RATE_LIMIT", "rate limited"))
                .thenReturn("Groq recovered reply");

        String body = mapper.writeValueAsString(Map.of("message", "Retry test prompt", "providerId", "groq"));

        // Attempt 1 fails
        mockMvc.perform(post("/api/chat/" + convId + "/messages")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code", is("GROQ_RATE_LIMIT")));

        // Attempt 2 succeeds
        chat(convId, "groq", "Retry test prompt");

        JsonNode messages = getConversationDetail(convId).path("messages");
        assertThat(messages).hasSize(2);
        assertThat(messages.get(0).path("senderType").asText()).isEqualTo("USER");
        assertThat(messages.get(0).path("content").asText()).isEqualTo("Retry test prompt");
        assertThat(messages.get(1).path("senderType").asText()).isEqualTo("ASSISTANT");
        assertThat(messages.get(1).path("content").asText()).isEqualTo("Groq recovered reply");
    }

    @Test
    @DisplayName("Groq unconfigured returns 503 GROQ_NOT_CONFIGURED and saves no assistant reply")
    void groqUnconfigured() throws Exception {
        when(groqService.isConfigured()).thenReturn(false);
        long convId = createConversation("groq", GROQ_MODEL);

        String body = mapper.writeValueAsString(Map.of("message", "Hello", "providerId", "groq"));
        mockMvc.perform(post("/api/chat/" + convId + "/messages")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code", is("GROQ_NOT_CONFIGURED")));

        verify(groqService, never()).sendMessage(anyList());
        assertThat(getConversationDetail(convId).path("messages")).isEmpty();
    }
}
