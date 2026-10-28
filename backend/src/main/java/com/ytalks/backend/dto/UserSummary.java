package com.ytalks.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;

/**
 * User summary for auth responses (no sensitive data).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record UserSummary(
        Long id,
        String name,
        String email,
        String phone,
        Instant createdAt
) {
}