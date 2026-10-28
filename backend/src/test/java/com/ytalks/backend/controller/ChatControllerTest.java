package com.ytalks.backend.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ytalks.backend.dto.ChatRequest;
import com.ytalks.backend.entity.Conversation;
import com.ytalks.backend.entity.Message;
import com.ytalks.backend.entity.SenderType;
import com.ytalks.backend.entity.User;
import com.ytalks.backend.exception.GeminiAuthException;
import com.ytalks.backend.exception.GeminiNotConfiguredException;
import com.ytalks.backend.exception.GeminiRateLimitException;
import com.ytalks.backend.security.JwtService;
import com.ytalks.backend.service.ConversationService;
import com.ytalks.backend.service.GeminiService;
import com.ytalks.backend.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.hamcrest.Matchers.is;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class ChatControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private UserService userService;

    @MockitoBean
    private ConversationService conversationService;

    @MockitoBean
    private GeminiService geminiService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private User testUser;
    private Conversation testConversation;
    private String authToken;

    @BeforeEach
    void setUp() {
        testUser = userService.findByEmail("aarav.sharma@example.com").orElseGet(() ->
                userService.createUser("Aarav Sharma", "aarav.sharma@example.com", "+91 98765 43210", "Demo@12345")
        );

        testConversation = new Conversation();
        testConversation.setId(10L);
        testConversation.setUser(testUser);
        testConversation.setTitle("Test Conversation");
        testConversation.setProviderId("gemini");
        testConversation.setModel("gemini-1.5-flash");

        authToken = jwtService.generateToken(testUser.getId());
    }

    @Test
    @DisplayName("GET /api/chat/providers returns providers with only Gemini marked as implemented")
    void getProvidersListsGeminiAsImplemented() throws Exception {
        when(geminiService.getModel()).thenReturn("gemini-1.5-flash");

        mockMvc.perform(get("/api/chat/providers"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id", is("gemini")))
                .andExpect(jsonPath("$[0].implemented", is(true)))
                .andExpect(jsonPath("$[1].id", is("openai")))
                .andExpect(jsonPath("$[1].implemented", is(false)))
                .andExpect(jsonPath("$[2].id", is("claude")))
                .andExpect(jsonPath("$[2].implemented", is(false)))
                .andExpect(jsonPath("$[3].id", is("deepseek")))
                .andExpect(jsonPath("$[3].implemented", is(false)));
    }

    @Test
    @DisplayName("POST /api/chat/{id}/messages rejects unauthenticated requests with 401/403")
    void rejectsUnauthenticated() throws Exception {
        ChatRequest request = new ChatRequest("Hello", "gemini", "gemini-1.5-flash");
        mockMvc.perform(post("/api/chat/10/messages")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("POST /api/chat/{id}/messages verifies conversation ownership using authenticated principal")
    void verifiesConversationOwnership() throws Exception {
        when(conversationService.findByIdAndUser(eq(99L), any(User.class)))
                .thenReturn(Optional.empty());

        ChatRequest request = new ChatRequest("Hello", "gemini", "gemini-1.5-flash");
        mockMvc.perform(post("/api/chat/99/messages")
                        .header("Authorization", "Bearer " + authToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code", is("RESOURCE_NOT_FOUND")));
    }

    @Test
    @DisplayName("POST /api/chat/{id}/messages rejects unsupported providers with 400")
    void rejectsUnsupportedProvider() throws Exception {
        when(conversationService.findByIdAndUser(eq(10L), any(User.class)))
                .thenReturn(Optional.of(testConversation));

        ChatRequest request = new ChatRequest("Hello", "openai", "gpt-4.1-mini");
        mockMvc.perform(post("/api/chat/10/messages")
                        .header("Authorization", "Bearer " + authToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("PROVIDER_NOT_SUPPORTED")));
    }

    @Test
    @DisplayName("POST /api/chat/{id}/messages returns 503 when Gemini is not configured")
    void returns503WhenGeminiNotConfigured() throws Exception {
        when(conversationService.findByIdAndUser(eq(10L), any(User.class)))
                .thenReturn(Optional.of(testConversation));
        when(geminiService.isConfigured()).thenReturn(false);

        ChatRequest request = new ChatRequest("Hello", "gemini", "gemini-1.5-flash");
        mockMvc.perform(post("/api/chat/10/messages")
                        .header("Authorization", "Bearer " + authToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code", is("GEMINI_NOT_CONFIGURED")));
    }

    @Test
    @DisplayName("POST /api/chat/{id}/messages successfully calls Gemini, saves messages, and returns assistant reply")
    void successfullyProcessesGeminiTurn() throws Exception {
        when(conversationService.findByIdAndUser(eq(10L), any(User.class)))
                .thenReturn(Optional.of(testConversation));
        when(geminiService.isConfigured()).thenReturn(true);
        when(geminiService.getModel()).thenReturn("gemini-1.5-flash");

        Message userMsg = new Message();
        userMsg.setId(101L);
        userMsg.setContent("What is Java?");
        userMsg.setSenderType(SenderType.USER);

        Message assistantMsg = new Message();
        assistantMsg.setId(102L);
        assistantMsg.setContent("Java is a high-level, class-based, object-oriented programming language.");
        assistantMsg.setSenderType(SenderType.ASSISTANT);
        assistantMsg.setProviderId("gemini");
        assistantMsg.setModel("gemini-1.5-flash");

        when(conversationService.findMessages(testConversation)).thenReturn(new ArrayList<>());
        when(conversationService.addUserMessage(eq(testConversation), eq("What is Java?"))).thenReturn(userMsg);
        when(geminiService.sendMessage(anyList())).thenReturn("Java is a high-level, class-based, object-oriented programming language.");
        when(conversationService.addAssistantMessage(eq(testConversation), anyString(), eq("gemini"), eq("gemini-1.5-flash")))
                .thenReturn(assistantMsg);

        ChatRequest request = new ChatRequest("What is Java?", "gemini", "gemini-1.5-flash");
        mockMvc.perform(post("/api/chat/10/messages")
                        .header("Authorization", "Bearer " + authToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messageId", is("102")))
                .andExpect(jsonPath("$.providerId", is("gemini")))
                .andExpect(jsonPath("$.model", is("gemini-1.5-flash")))
                .andExpect(jsonPath("$.content", is("Java is a high-level, class-based, object-oriented programming language.")));

        verify(conversationService, times(1)).addUserMessage(testConversation, "What is Java?");
        verify(conversationService, times(1)).addAssistantMessage(testConversation, "Java is a high-level, class-based, object-oriented programming language.", "gemini", "gemini-1.5-flash");
    }

    @Test
    @DisplayName("POST /api/chat/{id}/messages does not duplicate user message if retried after failure")
    void doesNotDuplicateUserMessageOnRetry() throws Exception {
        when(conversationService.findByIdAndUser(eq(10L), any(User.class)))
                .thenReturn(Optional.of(testConversation));
        when(geminiService.isConfigured()).thenReturn(true);
        when(geminiService.getModel()).thenReturn("gemini-1.5-flash");

        Message existingUserMsg = new Message();
        existingUserMsg.setId(101L);
        existingUserMsg.setContent("Retry message");
        existingUserMsg.setSenderType(SenderType.USER);

        when(conversationService.findMessages(testConversation)).thenReturn(List.of(existingUserMsg));

        Message assistantMsg = new Message();
        assistantMsg.setId(102L);
        assistantMsg.setContent("Recovered response");
        assistantMsg.setSenderType(SenderType.ASSISTANT);
        assistantMsg.setProviderId("gemini");
        assistantMsg.setModel("gemini-1.5-flash");

        when(geminiService.sendMessage(anyList())).thenReturn("Recovered response");
        when(conversationService.addAssistantMessage(eq(testConversation), anyString(), eq("gemini"), eq("gemini-1.5-flash")))
                .thenReturn(assistantMsg);

        ChatRequest request = new ChatRequest("Retry message", "gemini", "gemini-1.5-flash");
        mockMvc.perform(post("/api/chat/10/messages")
                        .header("Authorization", "Bearer " + authToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", is("Recovered response")));

        verify(conversationService, never()).addUserMessage(any(), any());
    }

    @Test
    @DisplayName("POST /api/chat/{id}/messages handles Gemini rate limit with 429 response")
    void handlesGeminiRateLimit() throws Exception {
        when(conversationService.findByIdAndUser(eq(10L), any(User.class)))
                .thenReturn(Optional.of(testConversation));
        when(geminiService.isConfigured()).thenReturn(true);
        when(geminiService.getModel()).thenReturn("gemini-1.5-flash");
        when(conversationService.findMessages(testConversation)).thenReturn(new ArrayList<>());
        when(geminiService.sendMessage(anyList())).thenThrow(new GeminiRateLimitException("Rate limit reached"));

        ChatRequest request = new ChatRequest("Test prompt", "gemini", "gemini-1.5-flash");
        mockMvc.perform(post("/api/chat/10/messages")
                        .header("Authorization", "Bearer " + authToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code", is("GEMINI_RATE_LIMIT")));
    }

    @Test
    @DisplayName("POST /api/chat/{id}/messages handles Gemini invalid auth with BAD_GATEWAY response")
    void handlesGeminiAuthFailure() throws Exception {
        when(conversationService.findByIdAndUser(eq(10L), any(User.class)))
                .thenReturn(Optional.of(testConversation));
        when(geminiService.isConfigured()).thenReturn(true);
        when(geminiService.getModel()).thenReturn("gemini-1.5-flash");
        when(conversationService.findMessages(testConversation)).thenReturn(new ArrayList<>());
        when(geminiService.sendMessage(anyList())).thenThrow(new GeminiAuthException("Invalid API key"));

        ChatRequest request = new ChatRequest("Test prompt", "gemini", "gemini-1.5-flash");
        mockMvc.perform(post("/api/chat/10/messages")
                        .header("Authorization", "Bearer " + authToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code", is("GEMINI_AUTH_FAILED")));
    }
}
