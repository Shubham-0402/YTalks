package com.ytalks.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.ytalks.backend.config.OpenRouterProperties;
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

/** Mocked-upstream tests: a local HTTP server stands in for OpenRouter. No real API is called. */
class OpenRouterServiceTest {

    private static final String KEY = "sk-or-v1-test-secret-key-123";
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
        server.createContext("/api/v1/chat/completions", exchange -> {
            lastBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            lastAuth.set(exchange.getRequestHeaders().getFirst("Authorization"));
            try {
                Thread.sleep(delayMs);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            byte[] out = responseBody.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            try {
                exchange.sendResponseHeaders(status, out.length);
                exchange.getResponseBody().write(out);
            } catch (IOException ignored) {
                // client timed out and closed the connection
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

    private OpenRouterService service(String key, int timeoutMs) {
        OpenRouterProperties p = new OpenRouterProperties();
        p.setApiKey(key);
        p.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/api/v1");
        p.setTimeoutMs(timeoutMs);
        return new OpenRouterService(p);
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
    @DisplayName("builds an OpenAI-style request with exact model, bearer auth, ordered turns and no SYSTEM rows")
    void requestConstruction() throws Exception {
        responseBody = ok("hello");
        List<Message> history = List.of(
                msg(SenderType.USER, "Explain machine learning.", null),
                msg(SenderType.ASSISTANT, "ML learns patterns from data.", "gemini"),
                msg(SenderType.SYSTEM, "Context transferred from Google Gemini -> Gemma 4 (OpenRouter), 2 messages transferred", null),
                msg(SenderType.USER, "Now give an example.", null));

        service(KEY, 5000).sendMessage(history);

        assertThat(lastAuth.get()).isEqualTo("Bearer " + KEY);
        JsonNode body = MAPPER.readTree(lastBody.get());
        assertThat(body.path("model").asText()).isEqualTo("google/gemma-4-26b-a4b-it:free");
        JsonNode messages = body.path("messages");
        assertThat(messages).hasSize(3);
        assertThat(messages.get(0).path("role").asText()).isEqualTo("user");
        assertThat(messages.get(1).path("role").asText()).isEqualTo("assistant");
        assertThat(messages.get(1).path("content").asText()).isEqualTo("ML learns patterns from data.");
        assertThat(messages.get(2).path("content").asText()).isEqualTo("Now give an example.");
        assertThat(lastBody.get()).doesNotContain("Context transferred").doesNotContain(KEY);
    }

    @Test
    @DisplayName("parses the real assistant text from choices[0].message.content")
    void parsesSuccessfulResponse() {
        responseBody = ok("  Gemma says hi.  ");
        String reply = service(KEY, 5000).sendMessage(List.of(msg(SenderType.USER, "Hi", null)));
        assertThat(reply).isEqualTo("Gemma says hi.");
    }

    @Test
    @DisplayName("handoff: Gemini history + new user message is sent to Gemma in order")
    void geminiToGemmaContextHandoff() throws Exception {
        responseBody = ok("As Gemma, here is more.");
        List<Message> history = List.of(
                msg(SenderType.USER, "Explain machine learning.", null),
                msg(SenderType.ASSISTANT, "Gemini answer about ML.", "gemini"),
                msg(SenderType.USER, "Continue please.", null));

        service(KEY, 5000).sendMessage(history);

        JsonNode messages = MAPPER.readTree(lastBody.get()).path("messages");
        assertThat(messages).hasSize(3);
        assertThat(messages.get(0).path("content").asText()).isEqualTo("Explain machine learning.");
        assertThat(messages.get(1).path("role").asText()).isEqualTo("assistant");
        assertThat(messages.get(1).path("content").asText()).isEqualTo("Gemini answer about ML.");
        assertThat(messages.get(2).path("content").asText()).isEqualTo("Continue please.");
    }

    @Test
    @DisplayName("a fresh conversation sends only the new user message (no previous context)")
    void freshConversationHasNoPreviousContext() throws Exception {
        responseBody = ok("Fresh start.");
        service(KEY, 5000).sendMessage(List.of(msg(SenderType.USER, "Hello Gemma", null)));
        assertThat(MAPPER.readTree(lastBody.get()).path("messages")).hasSize(1);
    }

    @Test
    @DisplayName("missing API key fails clearly without calling OpenRouter")
    void missingApiKey() {
        lastBody.set(null);
        assertThatThrownBy(() -> service("", 5000).sendMessage(List.of(msg(SenderType.USER, "Hi", null))))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getCode()).isEqualTo("OPENROUTER_NOT_CONFIGURED"));
        assertThat(lastBody.get()).isNull();
    }

    private void expectError(int httpStatus, String upstreamMsg, String code) {
        status = httpStatus;
        responseBody = "{\"error\":{\"code\":" + httpStatus + ",\"message\":" + quote(upstreamMsg) + "}}";
        assertThatThrownBy(() -> service(KEY, 5000).sendMessage(List.of(msg(SenderType.USER, "Hi", null))))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> {
                    ApiException ex = (ApiException) e;
                    assertThat(ex.getCode()).isEqualTo(code);
                    assertThat(ex.getMessage()).doesNotContain(KEY);
                });
    }

    @Test
    @DisplayName("invalid API key (401) maps to OPENROUTER_AUTH_FAILED and never leaks the key")
    void invalidApiKey() {
        expectError(401, "No auth credentials found for " + KEY, "OPENROUTER_AUTH_FAILED");
    }

    @Test
    @DisplayName("403 maps to OPENROUTER_AUTH_FAILED")
    void forbidden() {
        expectError(403, "Forbidden", "OPENROUTER_AUTH_FAILED");
    }

    @Test
    @DisplayName("402 maps to OPENROUTER_PAYMENT_REQUIRED")
    void paymentRequired() {
        expectError(402, "Insufficient credits", "OPENROUTER_PAYMENT_REQUIRED");
    }

    @Test
    @DisplayName("429 maps to OPENROUTER_RATE_LIMIT")
    void rateLimited() {
        expectError(429, "Rate limit exceeded", "OPENROUTER_RATE_LIMIT");
    }

    @Test
    @DisplayName("503 maps to OPENROUTER_UNAVAILABLE")
    void serviceUnavailable() {
        expectError(503, "No available provider", "OPENROUTER_UNAVAILABLE");
    }

    @Test
    @DisplayName("slow upstream maps to OPENROUTER_TIMEOUT")
    void timeout() {
        responseBody = ok("too late");
        delayMs = 1500;
        assertThatThrownBy(() -> service(KEY, 300).sendMessage(List.of(msg(SenderType.USER, "Hi", null))))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getCode()).isEqualTo("OPENROUTER_TIMEOUT"));
    }

    @Test
    @DisplayName("empty assistant content is an error, not a fake reply")
    void emptyContentIsError() {
        responseBody = "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":null}}]}";
        assertThatThrownBy(() -> service(KEY, 5000).sendMessage(List.of(msg(SenderType.USER, "Hi", null))))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getCode()).isEqualTo("OPENROUTER_ERROR"));
    }
}
