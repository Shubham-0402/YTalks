package com.ytalks.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * Thrown when the Gemini service is called but GEMINI_API_KEY is not configured.
 */
public class GeminiNotConfiguredException extends ApiException {

    public GeminiNotConfiguredException(String message) {
        super(HttpStatus.SERVICE_UNAVAILABLE, "GEMINI_NOT_CONFIGURED", message);
    }
}

