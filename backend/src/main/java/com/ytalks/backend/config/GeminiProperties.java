package com.ytalks.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Configuration properties for the Google Gemini AI provider.
 * <p>
 * Values come from {@code application.yml} and can be overridden with
 * environment variables, e.g. {@code GEMINI_API_KEY=your-key}.
 */
@Component
@ConfigurationProperties(prefix = "ytalks.gemini")
public class GeminiProperties {

    private String apiKey;
    private String model = "gemini-1.5-flash";
    private int timeoutMs = 30000;

    public String getApiKey() {
        return apiKey;
    }

    public void setApiKey(String apiKey) {
        this.apiKey = sanitizeValue(apiKey);
    }

    public String getModel() {
        return model;
    }

    public void setModel(String model) {
        String cleaned = sanitizeValue(model);
        if (cleaned != null && !cleaned.isBlank()) {
            this.model = cleaned;
        }
    }

    public int getTimeoutMs() {
        return timeoutMs;
    }

    public void setTimeoutMs(int timeoutMs) {
        this.timeoutMs = timeoutMs;
    }

    /**
     * Checks if the Gemini provider is properly configured.
     */
    public boolean isConfigured() {
        return apiKey != null
                && !apiKey.isBlank()
                && !"your-gemini-api-key-here".equalsIgnoreCase(apiKey);
    }

    private static String sanitizeValue(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.length() >= 2
                && ((trimmed.startsWith("\"") && trimmed.endsWith("\""))
                || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
            trimmed = trimmed.substring(1, trimmed.length() - 1).trim();
        }
        return trimmed;
    }
}