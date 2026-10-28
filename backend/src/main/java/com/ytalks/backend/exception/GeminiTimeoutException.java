package com.ytalks.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * Thrown when a request to the Gemini API times out.
 */
public class GeminiTimeoutException extends ApiException {

    public GeminiTimeoutException(String message, Throwable cause) {
        super(HttpStatus.GATEWAY_TIMEOUT, "GEMINI_TIMEOUT", message);
        initCause(cause);
    }

    public GeminiTimeoutException(String message) {
        super(HttpStatus.GATEWAY_TIMEOUT, "GEMINI_TIMEOUT", message);
    }
}

