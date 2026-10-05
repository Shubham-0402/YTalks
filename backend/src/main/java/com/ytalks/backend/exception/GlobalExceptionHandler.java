package com.ytalks.backend.exception;

import java.time.Instant;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import com.ytalks.backend.config.ApiRequestContextFilter;
import com.ytalks.backend.dto.ApiErrorResponse;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;

/**
 * Turns every failure into the same JSON envelope.
 *
 * <p>Rules the frontend can rely on:
 * <ul>
 *   <li>the body always has {@code status}, {@code code}, {@code message},
 *       {@code path} and {@code requestId};</li>
 *   <li>{@code message} is safe to show to a user â€” stack traces, SQL and
 *       configuration never appear in a response;</li>
 *   <li>anything unanticipated becomes a generic 500 with the real cause kept in
 *       the server log, correlated by {@code requestId}.</li>
 * </ul>
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** Spring Boot 3.2+ reports unmapped paths as a missing static resource. */
    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiErrorResponse> handleMissingResource(NoResourceFoundException ex, HttpServletRequest request) {
        return build(HttpStatus.NOT_FOUND, "NOT_FOUND", "No API endpoint matches " + request.getRequestURI(), request);
    }

    @ExceptionHandler(NoHandlerFoundException.class)
    ResponseEntity<ApiErrorResponse> handleNoHandler(NoHandlerFoundException ex, HttpServletRequest request) {
        return build(HttpStatus.NOT_FOUND, "NOT_FOUND", "No API endpoint matches " + request.getRequestURI(), request);
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    ResponseEntity<ApiErrorResponse> handleNotFound(ResourceNotFoundException ex, HttpServletRequest request) {
        return build(ex.getStatus(), ex.getCode(), ex.getMessage(), request);
    }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiErrorResponse> handleApiException(ApiException ex, HttpServletRequest request) {
        log.warn("{} {}: {}", ex.getCode(), request.getRequestURI(), ex.getMessage());
        return build(ex.getStatus(), ex.getCode(), ex.getMessage(), request);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiErrorResponse> handleValidation(MethodArgumentNotValidException ex, HttpServletRequest request) {
        List<ApiErrorResponse.FieldError> fieldErrors = ex.getBindingResult().getAllErrors().stream()
                .map(error -> new ApiErrorResponse.FieldError(
                        error instanceof FieldError field ? field.getField() : error.getObjectName(),
                        error.getDefaultMessage()))
                .toList();
        log.warn("Validation failed on {}: {} field error(s)", request.getRequestURI(), fieldErrors.size());
        return build(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "The request body is not valid", request, fieldErrors);
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class,
            MissingServletRequestParameterException.class, ConstraintViolationException.class})
    ResponseEntity<ApiErrorResponse> handleBadRequest(Exception ex, HttpServletRequest request) {
        log.warn("Malformed request on {}: {}", request.getRequestURI(), ex.getMessage());
        return build(HttpStatus.BAD_REQUEST, "BAD_REQUEST", "The request could not be read or parsed", request);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ApiErrorResponse> handleMethodNotAllowed(HttpRequestMethodNotSupportedException ex,
            HttpServletRequest request) {
        String allowed = ex.getSupportedHttpMethods() == null
                ? "GET"
                : ex.getSupportedHttpMethods().stream().map(Object::toString).sorted().reduce((a, b) -> a + ", " + b)
                        .orElse("GET");
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.ALLOW, allowed);
        return build(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED",
                request.getMethod() + " is not supported on " + request.getRequestURI(), request, List.of(), headers);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiErrorResponse> handleUnexpected(Exception ex, HttpServletRequest request) {
        log.error("Unhandled exception on {}", request.getRequestURI(), ex);
        return build(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR",
                "The server could not complete the request", request);
    }

    private ResponseEntity<ApiErrorResponse> build(HttpStatus status, String code, String message,
            HttpServletRequest request) {
        return build(status, code, message, request, List.of(), new HttpHeaders());
    }

    private ResponseEntity<ApiErrorResponse> build(HttpStatus status, String code, String message,
            HttpServletRequest request, List<ApiErrorResponse.FieldError> fieldErrors) {
        return build(status, code, message, request, fieldErrors, new HttpHeaders());
    }

    private ResponseEntity<ApiErrorResponse> build(HttpStatus status, String code, String message,
            HttpServletRequest request, List<ApiErrorResponse.FieldError> fieldErrors, HttpHeaders headers) {
        ApiErrorResponse body = new ApiErrorResponse(
                Instant.now(),
                status.value(),
                status.getReasonPhrase(),
                code,
                message,
                request.getRequestURI(),
                fieldErrors.isEmpty() ? null : fieldErrors,
                requestId(request));
        return new ResponseEntity<>(body, headers, status);
    }

    private String requestId(HttpServletRequest request) {
        Object attribute = request.getAttribute(ApiRequestContextFilter.ATTRIBUTE);
        return attribute == null ? null : attribute.toString();
    }
}
