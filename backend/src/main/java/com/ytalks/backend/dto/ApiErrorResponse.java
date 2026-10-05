package com.ytalks.backend.dto;

import java.time.Instant;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Uniform error body for every non-2xx API response.
 *
 * <p>Clients get a stable shape and a machine readable {@code code}; internal
 * messages, stack traces and configuration never leave the service. The
 * correlation id is returned in the {@code X-Request-Id} header so a frontend
 * log line and a backend log line can be matched.
 *
 * @param timestamp when the error was produced
 * @param status HTTP status code
 * @param error HTTP reason phrase
 * @param code stable machine readable code, e.g. {@code VALIDATION_FAILED}
 * @param message short human readable summary
 * @param path the request path that failed
 * @param fieldErrors per-field validation problems, when applicable
 * @param requestId correlation id
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiErrorResponse(
        Instant timestamp,
        int status,
        String error,
        String code,
        String message,
        String path,
        List<FieldError> fieldErrors,
        String requestId) {

    /**
     * A single rejected field.
     *
     * @param field property name
     * @param message why it was rejected
     */
    public record FieldError(String field, String message) {
    }
}
