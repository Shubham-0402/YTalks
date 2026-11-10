package com.ytalks.backend.controller;

import com.ytalks.backend.dto.ChatRequest;
import com.ytalks.backend.dto.ChatResponse;
import com.ytalks.backend.entity.Conversation;
import com.ytalks.backend.entity.Message;
import com.ytalks.backend.entity.SenderType;
import com.ytalks.backend.entity.User;
import com.ytalks.backend.exception.ApiException;
import com.ytalks.backend.exception.GeminiNotConfiguredException;
import com.ytalks.backend.exception.ResourceNotFoundException;
import com.ytalks.backend.security.UserPrincipal;
import com.ytalks.backend.service.ConversationService;
import com.ytalks.backend.service.GeminiService;
import com.ytalks.backend.service.GroqService;
import com.ytalks.backend.service.OpenRouterService;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * REST endpoints for AI chat functionality.
 * <p>
 * Handles sending messages to the Google Gemini AI provider and persisting
 * the conversation and messages in MySQL. All endpoints require JWT authentication.
 */
@RestController
@RequestMapping("/api/chat")
public class ChatController {

    private static final Logger log = LoggerFactory.getLogger(ChatController.class);

    private final ConversationService conversationService;
    private final GeminiService geminiService;
    private final OpenRouterService openRouterService;
    private final GroqService groqService;

    public ChatController(ConversationService conversationService, GeminiService geminiService,
                          OpenRouterService openRouterService, GroqService groqService) {
        this.conversationService = conversationService;
        this.geminiService = geminiService;
        this.openRouterService = openRouterService;
        this.groqService = groqService;
    }

    private User getCurrentUser(UserPrincipal userPrincipal) {
        if (userPrincipal == null || userPrincipal.getUser() == null) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Authentication required");
        }
        return userPrincipal.getUser();
    }

    /**
     * Sends a message to the Google Gemini provider and returns the response.
     * <p>
     * 1. Verifies conversation ownership using the authenticated user principal.
     * 2. Saves the user's message to MySQL (avoiding duplication if this is a retry).
     * 3. Sends relevant conversation history to the Gemini API.
     * 4. Persists the Gemini assistant response in MySQL.
     * 5. Returns the assistant response with metadata to the client.
     */
    @PostMapping(value = "/{conversationId}/messages", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ChatResponse> sendMessage(
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @PathVariable Long conversationId,
            @Valid @RequestBody ChatRequest request) {

        User user = getCurrentUser(userPrincipal);
        long startTime = System.currentTimeMillis();

        // 1. Verify conversation ownership
        Conversation conversation = conversationService.findByIdAndUser(conversationId, user)
                .orElseThrow(() -> new ResourceNotFoundException("Conversation", conversationId.toString()));

        // 2. Validate provider
        String providerId = request.providerId() != null ? request.providerId() : conversation.getProviderId();
        boolean isGroq = providerId != null && providerId.equalsIgnoreCase("groq");
        boolean isGemma = providerId != null && providerId.equalsIgnoreCase("gemma");
        boolean isGemini = providerId != null && providerId.equalsIgnoreCase("gemini");
        if (providerId == null || !(isGroq || isGemma || isGemini)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PROVIDER_NOT_SUPPORTED",
                    "Only Google Gemini, Groq, and Gemma 4 (OpenRouter) are supported. Requested: " + providerId);
        }

        // 3. Verify the selected provider is configured
        if (isGroq) {
            if (!groqService.isConfigured()) {
                throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "GROQ_NOT_CONFIGURED",
                        "Groq is not configured. Please set GROQ_API_KEY in the backend environment.");
            }
        } else if (isGemma) {
            if (!openRouterService.isConfigured()) {
                throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "OPENROUTER_NOT_CONFIGURED",
                        "Gemma (OpenRouter) is not configured. Please set OPENROUTER_API_KEY in the backend environment.");
            }
        } else if (!geminiService.isConfigured()) {
            throw new GeminiNotConfiguredException(
                    "Gemini provider is not configured. Please set GEMINI_API_KEY environment variable.");
        }

        String userText = request.message().trim();

        // 4. Save user message or detect retry of unanswered message
        List<Message> history = conversationService.findMessages(conversation);
        Message userMessage = null;
        if (!history.isEmpty()) {
            Message lastMsg = history.get(history.size() - 1);
            if (lastMsg.getSenderType() == SenderType.USER && userText.equals(lastMsg.getContent())) {
                userMessage = lastMsg;
            }
        }

        if (userMessage == null) {
            userMessage = conversationService.addUserMessage(conversation, userText);
            history = new java.util.ArrayList<>(conversationService.findMessages(conversation));
            if (history.isEmpty() || !java.util.Objects.equals(history.get(history.size() - 1).getId(), userMessage.getId())) {
                history.add(userMessage);
            }
        }

        // 5. Send conversation history to Gemini
        // History = every saved USER/ASSISTANT row of this conversation (from MySQL), so a provider
        // switched to mid-conversation receives the earlier turns as explicit context.
        String savedProvider = isGroq ? "groq" : (isGemma ? "gemma" : "gemini");
        String configuredModel = isGroq ? groqService.getModel() : (isGemma ? openRouterService.getModel() : geminiService.getModel());
        String model = (configuredModel != null && !configuredModel.isBlank())
                ? configuredModel
                : (request.model() != null && !request.model().isBlank() ? request.model() : conversation.getModel());

        log.info("Sending chat message for conversation {} to {} ({})", conversationId, savedProvider, model);
        String assistantResponse;
        if (isGroq) {
            assistantResponse = groqService.sendMessage(history);
        } else if (isGemma) {
            assistantResponse = openRouterService.sendMessage(history);
        } else {
            assistantResponse = geminiService.sendMessage(history);
        }

        // 6. Save assistant response to MySQL
        Message assistantMessage = conversationService.addAssistantMessage(
                conversation, assistantResponse, savedProvider, model);

        long latencyMs = System.currentTimeMillis() - startTime;

        ChatResponse response = new ChatResponse(
                String.valueOf(assistantMessage.getId()),
                assistantResponse,
                savedProvider,
                assistantMessage.getModel(),
                latencyMs
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Gets the list of available AI providers.
     * Clearly indicates Gemini as implemented and others as unavailable/coming soon.
     */
    @GetMapping(value = "/providers", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<ProviderInfo>> getProviders() {
        return ResponseEntity.ok(List.of(
                new ProviderInfo("gemini", "Google Gemini", geminiService.getModel(), true),
                new ProviderInfo("openai", "OpenAI", "gpt-4.1-mini", false),
                new ProviderInfo("claude", "Anthropic Claude", "claude-sonnet-4-5", false),
                new ProviderInfo("deepseek", "DeepSeek", "deepseek-chat", false),
                new ProviderInfo("gemma", "Gemma 4 (OpenRouter)", openRouterService.getModel(), openRouterService.isConfigured()),
                new ProviderInfo("groq", "Groq", groqService.getModel(), groqService.isConfigured())
        ));
    }

    /**
     * Provider metadata record.
     */
    public record ProviderInfo(
            String id,
            String name,
            String defaultModel,
            boolean implemented
    ) {
    }
}
