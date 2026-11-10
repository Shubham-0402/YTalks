package com.ytalks.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;

/**
 * Response after successful authentication.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AuthResponse(
        String accessToken,
        long expiresInMs,
        UserSummary user,
        String devOtp
) {
    public AuthResponse(String accessToken, long expiresInMs, UserSummary user) {
        this(accessToken, expiresInMs, user, null);
    }
}