package com.ytalks.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * Thrown when Gemini API rate limit or quota is exceeded.
 */
public class GeminiRateLimitException extends ApiException {

    public GeminiRateLimitException(String message, Throwable cause) {
        super(HttpStatus.TOO_MANY_REQUESTS, "GEMINI_RATE_LIMIT", message);
        initCause(cause);
    }

    public GeminiRateLimitException(String message) {
        super(HttpStatus.TOO_MANY_REQUESTS, "GEMINI_RATE_LIMIT", message);
    }
}

