package com.ytalks.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.ytalks.backend.config.GroqProperties;
import com.ytalks.backend.entity.Message;
import com.ytalks.backend.entity.SenderType;
import com.ytalks.backend.exception.ApiException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Unit tests for {@link GroqService} using a local mock HTTP server.
 * No external network calls are made.
 */
class GroqServiceTest {

    private static final String TEST_KEY = "gsk_test_secret_key_123456789";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private HttpServer server;
    private final AtomicReference<String> lastBody = new AtomicReference<>();
    private final AtomicReference<String> lastAuth = new AtomicReference<>();
    private volatile int status = 200;
    private volatile String responseBody = "";
    private volatile long delayMs = 0;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/openai/v1/chat/completions", exchange -> {
            lastBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            lastAuth.set(exchange.getRequestHeaders().getFirst("Authorization"));
            try {
                if (delayMs > 0) {
                    Thread.sleep(delayMs);
                }
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            byte[] out = responseBody.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            try {
                exchange.sendResponseHeaders(status, out.length);
                exchange.getResponseBody().write(out);
            } catch (IOException ignored) {
                // Client closed
            } finally {
                exchange.close();
            }
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private GroqService service(String key, int timeoutMs) {
        GroqProperties p = new GroqProperties();
        p.setApiKey(key);
        p.setModel("openai/gpt-oss-20b");
        p.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/openai/v1");
        p.setTimeoutMs(timeoutMs);
        return new GroqService(p);
    }

    private static Message msg(SenderType type, String content, String provider) {
        Message m = new Message();
        m.setSenderType(type);
        m.setContent(content);
        m.setProviderId(provider);
        return m;
    }

    private static String ok(String text) {
        return "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":" + quote(text) + "}}]}";
    }

    private static String quote(String s) {
        return "\"" + s.replace("\"", "\\\"") + "\"";
    }

    @Test
    @DisplayName("Builds OpenAI-style request with GROQ_MODEL, Bearer token, and sanitized messages")
    void requestConstruction() throws Exception {
        responseBody = ok("Machine learning is a field of AI.");
        List<Message> history = List.of(
                msg(SenderType.USER, "Explain Machine Learning.", null),
                msg(SenderType.ASSISTANT, "Machine learning enables computers to learn from data.", "gemini"),
                msg(SenderType.SYSTEM, "Context transferred from Google Gemini → Groq, 2 messages transferred", null),
                msg(SenderType.USER, "Now explain its applications.", null)
        );

        service(TEST_KEY, 5000).sendMessage(history);

        assertThat(lastAuth.get()).isEqualTo("Bearer " + TEST_KEY);
        JsonNode body = MAPPER.readTree(lastBody.get());
        assertThat(body.path("model").asText()).isEqualTo("openai/gpt-oss-20b");
        JsonNode messages = body.path("messages");
        assertThat(messages).hasSize(3);
        assertThat(messages.get(0).path("role").asText()).isEqualTo("user");
        assertThat(messages.get(0).path("content").asText()).isEqualTo("Explain Machine Learning.");
        assertThat(messages.get(1).path("role").asText()).isEqualTo("assistant");
        assertThat(messages.get(1).path("content").asText()).isEqualTo("Machine learning enables computers to learn from data.");
        assertThat(messages.get(2).path("role").asText()).isEqualTo("user");
        assertThat(messages.get(2).path("content").asText()).isEqualTo("Now explain its applications.");
        assertThat(lastBody.get()).doesNotContain("Context transferred").doesNotContain(TEST_KEY);
    }

    @Test
    @DisplayName("Parses the real assistant text from choices[0].message.content")
    void parsesSuccessfulResponse() {
        responseBody = ok("  Groq LPU response here.  ");
        String reply = service(TEST_KEY, 5000).sendMessage(List.of(msg(SenderType.USER, "Hi", null)));
        assertThat(reply).isEqualTo("Groq LPU response here.");
    }

    @Test
    @DisplayName("Context handoff: Gemini history + new user message is passed to Groq in order")
    void geminiToGroqContextHandoff() throws Exception {
        responseBody = ok("Applications of ML include healthcare and autonomous driving.");
        List<Message> history = List.of(
                msg(SenderType.USER, "Explain Machine Learning.", null),
                msg(SenderType.ASSISTANT, "Detailed Gemini explanation.", "gemini"),
                msg(SenderType.USER, "What are its applications?", null)
        );

        service(TEST_KEY, 5000).sendMessage(history);

        JsonNode messages = MAPPER.readTree(lastBody.get()).path("messages");
        assertThat(messages).hasSize(3);
        assertThat(messages.get(0).path("content").asText()).isEqualTo("Explain Machine Learning.");
        assertThat(messages.get(1).path("role").asText()).isEqualTo("assistant");
        assertThat(messages.get(1).path("content").asText()).isEqualTo("Detailed Gemini explanation.");
        assertThat(messages.get(2).path("content").asText()).isEqualTo("What are its applications?");
    }

    @Test
    @DisplayName("A fresh conversation sends only the new user message without previous context")
    void freshConversationHasNoPreviousContext() throws Exception {
        responseBody = ok("Fresh conversation response.");
        service(TEST_KEY, 5000).sendMessage(List.of(msg(SenderType.USER, "New question", null)));

        JsonNode messages = MAPPER.readTree(lastBody.get()).path("messages");
        assertThat(messages).hasSize(1);
        assertThat(messages.get(0).path("content").asText()).isEqualTo("New question");
    }

    @Test
    @DisplayName("Missing API key throws GROQ_NOT_CONFIGURED before contacting network")
    void missingApiKey() {
        lastBody.set(null);
        assertThatThrownBy(() -> service("", 5000).sendMessage(List.of(msg(SenderType.USER, "Hi", null))))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getCode()).isEqualTo("GROQ_NOT_CONFIGURED"));
        assertThat(lastBody.get()).isNull();
    }

    private void expectError(int httpStatus, String upstreamMsg, String code) {
        status = httpStatus;
        responseBody = "{\"error\":{\"message\":" + quote(upstreamMsg) + ",\"type\":\"invalid_request_error\"}}";
        assertThatThrownBy(() -> service(TEST_KEY, 5000).sendMessage(List.of(msg(SenderType.USER, "Hi", null))))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> {
                    ApiException ex = (ApiException) e;
                    assertThat(ex.getCode()).isEqualTo(code);
                    assertThat(ex.getMessage()).doesNotContain(TEST_KEY);
                });
    }

    @Test
    @DisplayName("Invalid API key (401) maps to GROQ_AUTH_FAILED and redacts key")
    void invalidApiKey() {
        expectError(401, "Invalid API Key provided: " + TEST_KEY, "GROQ_AUTH_FAILED");
    }

    @Test
    @DisplayName("Rate limit (429) maps to GROQ_RATE_LIMIT")
    void rateLimit() {
        expectError(429, "Rate limit reached for model openai/gpt-oss-20b", "GROQ_RATE_LIMIT");
    }

    @Test
    @DisplayName("503 maps to GROQ_UNAVAILABLE")
    void serviceUnavailable() {
        expectError(503, "Service unavailable", "GROQ_UNAVAILABLE");
    }

    @Test
    @DisplayName("Request timeout maps to GROQ_TIMEOUT")
    void timeout() {
        responseBody = ok("Delayed");
        delayMs = 1200;
        assertThatThrownBy(() -> service(TEST_KEY, 200).sendMessage(List.of(msg(SenderType.USER, "Hi", null))))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getCode()).isEqualTo("GROQ_TIMEOUT"));
    }

    @Test
    @DisplayName("Empty assistant content throws GROQ_ERROR")
    void emptyContentThrowsError() {
        responseBody = "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"\"}}]}";
        assertThatThrownBy(() -> service(TEST_KEY, 5000).sendMessage(List.of(msg(SenderType.USER, "Hi", null))))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getCode()).isEqualTo("GROQ_ERROR"));
    }
}
