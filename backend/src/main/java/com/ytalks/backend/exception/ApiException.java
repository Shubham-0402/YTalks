package com.ytalks.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * Base class for failures the API reports on purpose.
 *
 * <p>Anything thrown as an {@code ApiException} is considered a known, expected
 * condition: it is logged at warn level and its message may safely be shown to a
 * client. Anything else is treated as a bug and reported as a generic 500.
 */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }
}
