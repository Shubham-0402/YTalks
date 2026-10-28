package com.ytalks.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * Thrown when the Gemini API returns authentication or API key failure.
 */
public class GeminiAuthException extends ApiException {

    public GeminiAuthException(String message, Throwable cause) {
        super(HttpStatus.BAD_GATEWAY, "GEMINI_AUTH_FAILED", message);
        initCause(cause);
    }

    public GeminiAuthException(String message) {
        super(HttpStatus.BAD_GATEWAY, "GEMINI_AUTH_FAILED", message);
    }
}

