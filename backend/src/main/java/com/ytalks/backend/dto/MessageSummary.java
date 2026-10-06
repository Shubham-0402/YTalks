package com.ytalks.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;

/**
 * Single message in a conversation.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record MessageSummary(
        Long id,
        String senderType,
        String content,
        String providerId,
        String model,
        Instant createdAt
) {
}