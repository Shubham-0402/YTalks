package com.ytalks.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * Exception for authentication/authorization failures.
 * <p>
 * These are expected conditions that should be reported to the client
 * with appropriate status codes and safe messages.
 */
public class AuthException extends ApiException {

    public AuthException(HttpStatus status, String code, String message) {
        super(status, code, message);
    }

    public static AuthException invalidCredentials() {
        return new AuthException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    public static AuthException invalidOtp() {
        return new AuthException(HttpStatus.BAD_REQUEST, "INVALID_OTP", "Invalid or expired OTP code");
    }

    public static AuthException otpExpired() {
        return new AuthException(HttpStatus.BAD_REQUEST, "OTP_EXPIRED", "OTP code has expired, please request a new one");
    }

    public static AuthException otpMaxAttempts() {
        return new AuthException(HttpStatus.TOO_MANY_REQUESTS, "OTP_MAX_ATTEMPTS", "Too many invalid OTP attempts, please request a new code");
    }

    public static AuthException emailAlreadyExists() {
        return new AuthException(HttpStatus.CONFLICT, "EMAIL_EXISTS", "An account with this email already exists");
    }

    public static AuthException accountNotVerified() {
        return new AuthException(HttpStatus.FORBIDDEN, "ACCOUNT_NOT_VERIFIED", "Please verify your email before logging in");
    }

    public static AuthException tokenMissing() {
        return new AuthException(HttpStatus.UNAUTHORIZED, "TOKEN_MISSING", "Authentication token is required");
    }

    public static AuthException tokenInvalid() {
        return new AuthException(HttpStatus.UNAUTHORIZED, "TOKEN_INVALID", "Invalid or expired authentication token");
    }
}