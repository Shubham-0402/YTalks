package com.ytalks.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;

/**
 * Conversation summary for list views.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ConversationSummary(
        Long id,
        String title,
        String providerId,
        String model,
        Instant createdAt,
        Instant updatedAt,
        int messageCount
) {
}