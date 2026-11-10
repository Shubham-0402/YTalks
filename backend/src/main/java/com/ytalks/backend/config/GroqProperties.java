package com.ytalks.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Configuration for the Groq AI provider.
 * <p>
 * The API key is read from the backend environment ({@code GROQ_API_KEY})
 * and the model from {@code GROQ_MODEL} (defaulting to {@code openai/gpt-oss-20b}).
 * Neither is exposed to frontend clients.
 */
@Component
@ConfigurationProperties(prefix = "ytalks.groq")
public class GroqProperties {

    public static final String DEFAULT_MODEL = "openai/gpt-oss-20b";

    private String apiKey;
    private String model = DEFAULT_MODEL;
    private String baseUrl = "https://api.groq.com/openai/v1";
    private int connectTimeoutMs = 10000;
    private int timeoutMs = 30000;

    public String getApiKey() {
        return apiKey;
    }

    public void setApiKey(String apiKey) {
        this.apiKey = clean(apiKey);
    }

    public String getModel() {
        return model;
    }

    public void setModel(String model) {
        String c = clean(model);
        if (c != null && !c.isBlank()) {
            this.model = c;
        }
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        String c = clean(baseUrl);
        if (c != null && !c.isBlank()) {
            this.baseUrl = c.endsWith("/") ? c.substring(0, c.length() - 1) : c;
        }
    }

    public int getConnectTimeoutMs() {
        return connectTimeoutMs;
    }

    public void setConnectTimeoutMs(int connectTimeoutMs) {
        this.connectTimeoutMs = connectTimeoutMs;
    }

    public int getTimeoutMs() {
        return timeoutMs;
    }

    public void setTimeoutMs(int timeoutMs) {
        this.timeoutMs = timeoutMs;
    }

    public boolean isConfigured() {
        return apiKey != null
                && !apiKey.isBlank()
                && !apiKey.toLowerCase().startsWith("your-")
                && !"your_actual_api_key".equalsIgnoreCase(apiKey);
    }

    private static String clean(String v) {
        if (v == null) {
            return null;
        }
        String t = v.trim();
        if (t.length() >= 2 && ((t.startsWith("\"") && t.endsWith("\"")) || (t.startsWith("'") && t.endsWith("'")))) {
            t = t.substring(1, t.length() - 1).trim();
        }
        return t;
    }
}
