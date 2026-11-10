package com.ytalks.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ytalks.backend.config.GroqProperties;
import com.ytalks.backend.entity.Message;
import com.ytalks.backend.entity.SenderType;
import com.ytalks.backend.exception.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * Service for communicating with the Groq API.
 * <p>
 * Groq exposes an OpenAI-compatible {@code /chat/completions} endpoint.
 * This service runs entirely in the backend and redacts API keys and sensitive
 * information from all error messages and logs.
 */
@Service
public class GroqService {

    private static final Logger log = LoggerFactory.getLogger(GroqService.class);
    private static final int MAX_HISTORY_MESSAGES = 40;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final GroqProperties properties;
    private final HttpClient httpClient;

    public GroqService(GroqProperties properties) {
        this.properties = properties;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(properties.getConnectTimeoutMs()))
                .build();
    }

    public boolean isConfigured() {
        return properties.isConfigured();
    }

    public String getModel() {
        return properties.getModel();
    }

    /**
     * Converts a list of persisted database messages into alternating OpenAI-style
     * chat turns for Groq.
     * <ul>
     *   <li>Internal SYSTEM records (handoff notices) are excluded.</li>
     *   <li>USER messages become role {@code user}.</li>
     *   <li>ASSISTANT messages (from Gemini, Groq, or other models) become role {@code assistant}.</li>
     *   <li>Consecutive turns with the same role are coalesced.</li>
     *   <li>History starts with a {@code user} turn.</li>
     *   <li>Capped to {@value #MAX_HISTORY_MESSAGES} most recent messages.</li>
     * </ul>
     */
    public List<ChatTurn> buildTurns(List<Message> messages) {
        List<ChatTurn> turns = new ArrayList<>();
        if (messages == null || messages.isEmpty()) {
            return turns;
        }

        int start = Math.max(0, messages.size() - MAX_HISTORY_MESSAGES);
        for (Message m : messages.subList(start, messages.size())) {
            if (m.getSenderType() == SenderType.SYSTEM || m.getContent() == null || m.getContent().isBlank()) {
                continue;
            }

            String role = m.getSenderType() == SenderType.ASSISTANT ? "assistant" : "user";
            if (!turns.isEmpty() && turns.get(turns.size() - 1).role().equals(role)) {
                ChatTurn last = turns.remove(turns.size() - 1);
                turns.add(new ChatTurn(role, last.content() + "\n\n" + m.getContent()));
            } else {
                turns.add(new ChatTurn(role, m.getContent()));
            }
        }

        while (!turns.isEmpty() && !"user".equals(turns.get(0).role())) {
            turns.remove(0);
        }

        return turns;
    }

    /**
     * Builds the JSON payload for {@code /chat/completions}.
     */
    String buildRequestBody(List<ChatTurn> turns) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("model", properties.getModel());

        ArrayNode arr = root.putArray("messages");
        for (ChatTurn t : turns) {
            arr.addObject()
                    .put("role", t.role())
                    .put("content", t.content());
        }

        root.put("temperature", 0.7);
        root.put("max_tokens", 2048);
        return root.toString();
    }

    /**
     * Sends conversation history to Groq and returns the generated assistant reply.
     *
     * @param messages conversation history including the latest user message
     * @return genuine assistant response from Groq
     */
    public String sendMessage(List<Message> messages) {
        if (!isConfigured()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "GROQ_NOT_CONFIGURED",
                    "Groq is not configured. Please set GROQ_API_KEY environment variable.");
        }

        List<ChatTurn> turns = buildTurns(messages);
        if (turns.isEmpty()) {
            throw new IllegalArgumentException("Cannot send empty conversation to Groq");
        }

        HttpRequest request = HttpRequest.newBuilder(URI.create(properties.getBaseUrl() + "/chat/completions"))
                .timeout(Duration.ofMillis(properties.getTimeoutMs()))
                .header("Authorization", "Bearer " + properties.getApiKey())
                .header("Content-Type", "application/json")
                .header("User-Agent", "Ytalks/1.0")
                .POST(HttpRequest.BodyPublishers.ofString(buildRequestBody(turns)))
                .build();

        HttpResponse<String> response;
        try {
            log.debug("Sending request to Groq model {} ({} turns)", properties.getModel(), turns.size());
            response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (HttpTimeoutException e) {
            throw new ApiException(HttpStatus.GATEWAY_TIMEOUT, "GROQ_TIMEOUT",
                    "Groq request timed out. Please try again.");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.BAD_GATEWAY, "GROQ_ERROR", "Groq request was interrupted.");
        } catch (IOException e) {
            String msg = e.getClass().getSimpleName();
            if (e instanceof java.net.http.HttpConnectTimeoutException || msg.toLowerCase().contains("timeout")) {
                throw new ApiException(HttpStatus.GATEWAY_TIMEOUT, "GROQ_TIMEOUT",
                        "Groq request timed out. Please try again.");
            }
            log.error("Groq connection failed: {}", msg);
            throw new ApiException(HttpStatus.BAD_GATEWAY, "GROQ_ERROR", "Could not reach Groq (" + msg + ").");
        }

        int status = response.statusCode();
        if (status < 200 || status >= 300) {
            String upstream = redact(extractErrorMessage(response.body()));
            log.error("Groq returned HTTP {}: {}", status, upstream);
            throw mapError(status, upstream);
        }

        return parseReply(response.body());
    }

    /**
     * Parses {@code choices[0].message.content} from a successful response body.
     */
    String parseReply(String body) {
        try {
            JsonNode root = MAPPER.readTree(body);
            if (root.has("error")) {
                throw new ApiException(HttpStatus.BAD_GATEWAY, "GROQ_ERROR",
                        "Groq error: " + redact(root.path("error").path("message").asText("unknown error")));
            }

            JsonNode content = root.path("choices").path(0).path("message").path("content");
            String text = content.isTextual() ? content.asText() : null;
            if (text == null || text.isBlank()) {
                throw new ApiException(HttpStatus.BAD_GATEWAY, "GROQ_ERROR",
                        "Groq returned an empty response.");
            }
            return text.trim();
        } catch (IOException e) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "GROQ_ERROR", "Groq returned an unreadable response.");
        }
    }

    private ApiException mapError(int status, String upstream) {
        String detail = upstream.isBlank() ? "" : " (" + upstream + ")";
        if (status == 401 || status == 403) {
            return new ApiException(HttpStatus.BAD_GATEWAY, "GROQ_AUTH_FAILED",
                    "Groq rejected the API key (HTTP " + status + ")." + detail);
        }
        if (status == 429) {
            return new ApiException(HttpStatus.TOO_MANY_REQUESTS, "GROQ_RATE_LIMIT",
                    "Groq rate limit reached. Please wait and try again." + detail);
        }
        if (status >= 500) {
            return new ApiException(HttpStatus.BAD_GATEWAY, "GROQ_UNAVAILABLE",
                    "Groq is temporarily unavailable (HTTP " + status + "). Please retry shortly." + detail);
        }
        return new ApiException(HttpStatus.BAD_GATEWAY, "GROQ_ERROR",
                "Groq request failed (HTTP " + status + ")." + detail);
    }

    private static String extractErrorMessage(String body) {
        try {
            JsonNode error = MAPPER.readTree(body).path("error");
            String message = error.path("message").isTextual() ? error.path("message").asText() : "";
            JsonNode details = error.path("details");
            if (details.isTextual() && !details.asText().isBlank()) {
                message = (message.isBlank() ? "" : message + ": ") + details.asText();
            }
            return message;
        } catch (Exception e) {
            return "";
        }
    }

    private String redact(String s) {
        if (s == null) {
            return "";
        }
        String key = properties.getApiKey();
        String out = (key != null && !key.isBlank()) ? s.replace(key, "[REDACTED]") : s;
        return out.replaceAll("gsk_[A-Za-z0-9_\\-]+", "[REDACTED]");
    }

    /**
     * Single chat turn in OpenAI-compatible format.
     */
    public record ChatTurn(String role, String content) {
    }
}
