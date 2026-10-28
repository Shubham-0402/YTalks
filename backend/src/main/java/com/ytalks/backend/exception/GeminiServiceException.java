package com.ytalks.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * Thrown when an error occurs while communicating with the Gemini AI service.
 */
public class GeminiServiceException extends ApiException {

    public GeminiServiceException(String message, Throwable cause) {
        super(HttpStatus.BAD_GATEWAY, "GEMINI_ERROR", message);
        initCause(cause);
    }

    public GeminiServiceException(String message) {
        super(HttpStatus.BAD_GATEWAY, "GEMINI_ERROR", message);
    }
}

