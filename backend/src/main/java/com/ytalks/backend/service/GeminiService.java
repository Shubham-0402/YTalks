package com.ytalks.backend.service;

import com.google.genai.Client;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.GenerateContentResponse;
import com.google.genai.types.HttpOptions;
import com.google.genai.types.Part;
import com.ytalks.backend.config.GeminiProperties;
import com.ytalks.backend.entity.Message;
import com.ytalks.backend.entity.SenderType;
import com.ytalks.backend.exception.GeminiAuthException;
import com.ytalks.backend.exception.GeminiNotConfiguredException;
import com.ytalks.backend.exception.GeminiRateLimitException;
import com.ytalks.backend.exception.GeminiServiceException;
import com.ytalks.backend.exception.GeminiTimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Service for communicating with the Google Gemini AI provider.
 * <p>
 * Handles sending conversation history and user messages to the Gemini API
 * using the official Google GenAI Java SDK (0.3.0).
 */
@Service
public class GeminiService {

    private static final Logger log = LoggerFactory.getLogger(GeminiService.class);
    private static final int MAX_HISTORY_MESSAGES = 40;

    private final GeminiProperties properties;
    private Client client;

    public GeminiService(GeminiProperties properties) {
        this.properties = properties;
        initializeClientIfConfigured();
    }

    /**
     * Initializes the Gemini Client instance if an API key is configured.
     */
    public synchronized void initializeClientIfConfigured() {
        if (properties.isConfigured() && this.client == null) {
            try {
                HttpOptions httpOptions = HttpOptions.builder()
                        .timeout(properties.getTimeoutMs())
                        .build();

                this.client = Client.builder()
                        .apiKey(properties.getApiKey())
                        .httpOptions(httpOptions)
                        .build();
                log.info("Google Gemini client initialized successfully with model: {}", properties.getModel());
            } catch (Exception e) {
                log.error("Failed to initialize Google Gemini client: {}", e.getMessage(), e);
            }
        }
    }

    /**
     * Package-private setter for testing with a mock Client.
     */
    void setClient(Client client) {
        this.client = client;
    }

    /**
     * Checks if the Gemini service is configured and ready to use.
     */
    public boolean isConfigured() {
        if (this.client == null && properties.isConfigured()) {
            initializeClientIfConfigured();
        }
        return properties.isConfigured() && client != null;
    }

    /**
     * Gets the configured model name.
     */
    public String getModel() {
        return properties.getModel();
    }

    /**
     * Sends a full conversation history (ending with the current user message) to Gemini.
     *
     * @param messages the conversation history including the latest user message
     * @return the assistant's response text
     * @throws GeminiNotConfiguredException if the API key is not configured
     * @throws GeminiServiceException if the API call fails
     */
    public String sendMessage(List<Message> messages) {
        if (!isConfigured()) {
            throw new GeminiNotConfiguredException("Gemini service is not configured. Set GEMINI_API_KEY environment variable.");
        }

        List<Content> contents = buildConversationHistory(messages);
        if (contents.isEmpty()) {
            throw new IllegalArgumentException("Cannot send empty conversation to Gemini");
        }

        GenerateContentConfig config = GenerateContentConfig.builder()
                .temperature(0.7f)
                .maxOutputTokens(8192)
                .build();

        String model = properties.getModel();
        try {
            log.debug("Sending request to Gemini model: {} ({} turns)", model, contents.size());
            GenerateContentResponse response = client.models.generateContent(
                    model,
                    contents,
                    config
            );

            String responseText = response != null ? response.text() : null;
            if (responseText == null || responseText.isBlank()) {
                log.warn("Gemini returned empty text response");
                throw new GeminiServiceException("Gemini API returned an empty response");
            }

            log.debug("Received response from Gemini ({} chars)", responseText.length());
            return responseText.trim();

        } catch (Exception e) {
            log.error("Gemini API call failed: {}", sanitizeMessage(e.getMessage()));
            throw parseGeminiException(e);
        }
    }

    /**
     * Builds conversation history formatted according to Google Gemini API requirements:
     * - Alternating user and model roles
     * - Consecutive same-role turns coalesced into single turns
     * - First turn must be "user"
     * - Capped to recent turns to respect model context window
     */
    public List<Content> buildConversationHistory(List<Message> messages) {
        List<Content> contents = new ArrayList<>();
        if (messages == null || messages.isEmpty()) {
            return contents;
        }

        // Cap to recent messages to avoid context overflow
        int startIdx = Math.max(0, messages.size() - MAX_HISTORY_MESSAGES);
        List<Message> recentMessages = messages.subList(startIdx, messages.size());

        String currentRole = null;
        StringBuilder currentText = new StringBuilder();

        for (Message message : recentMessages) {
            String role;
            if (message.getSenderType() == SenderType.ASSISTANT) {
                role = "model";
            } else {
                // USER or SYSTEM messages
                role = "user";
            }

            String content = message.getContent() != null ? message.getContent() : "";

            if (role.equals(currentRole)) {
                // Merge consecutive messages of the same role
                if (currentText.length() > 0) {
                    currentText.append("\n\n");
                }
                currentText.append(content);
            } else {
                if (currentRole != null && currentText.length() > 0) {
                    contents.add(Content.builder()
                            .role(currentRole)
                            .parts(List.of(Part.fromText(currentText.toString())))
                            .build());
                }
                currentRole = role;
                currentText = new StringBuilder(content);
            }
        }

        if (currentRole != null && currentText.length() > 0) {
            contents.add(Content.builder()
                    .role(currentRole)
                    .parts(List.of(Part.fromText(currentText.toString())))
                    .build());
        }

        // Ensure the conversation starts with a "user" turn
        while (!contents.isEmpty() && !"user".equals(contents.get(0).role().orElse(""))) {
            contents.remove(0);
        }

        return contents;
    }

    private RuntimeException parseGeminiException(Exception e) {
        if (e instanceof GeminiServiceException || e instanceof GeminiNotConfiguredException
                || e instanceof GeminiAuthException || e instanceof GeminiRateLimitException
                || e instanceof GeminiTimeoutException) {
            return (RuntimeException) e;
        }

        String rawMsg = e.getMessage() != null ? e.getMessage() : e.toString();
        String msg = sanitizeMessage(rawMsg);
        String lower = msg.toLowerCase();

        if (lower.contains("api_key") || lower.contains("apikey") || lower.contains("api key")
                || lower.contains("unauthenticated") || lower.contains("401") || lower.contains("403")
                || lower.contains("invalid authentication") || lower.contains("permission_denied")) {
            return new GeminiAuthException("Gemini API authentication failed: invalid or unauthorized GEMINI_API_KEY", e);
        }
        if (lower.contains("quota") || lower.contains("rate limit") || lower.contains("429")
                || lower.contains("resource_exhausted")) {
            return new GeminiRateLimitException("Gemini API rate limit exceeded. Please wait a moment before trying again.", e);
        }
        if (lower.contains("timeout") || lower.contains("timed out") || lower.contains("deadline_exceeded")) {
            return new GeminiTimeoutException("Gemini API request timed out. Please try again.", e);
        }
        if (lower.contains("not found") || lower.contains("404")) {
            return new GeminiServiceException("Gemini model not found: " + properties.getModel(), e);
        }

        if (lower.contains("503") || lower.contains("unavailable") || lower.contains("overloaded")) {
            return new GeminiServiceException("Gemini is temporarily unavailable (503). Please retry shortly.", e);
        }

        return new GeminiServiceException("Gemini API error: " + msg, e);
    }

    private String sanitizeMessage(String msg) {
        if (msg == null) {
            return "Unknown Gemini API error";
        }
        String sanitized = msg;
        String apiKey = properties.getApiKey();
        if (apiKey != null && !apiKey.isBlank()) {
            sanitized = sanitized.replace(apiKey, "[REDACTED]");
        }
        sanitized = sanitized.replaceAll("([?&]key=)[^&\\s]+", "$1[REDACTED]");
        return sanitized;
    }
}
