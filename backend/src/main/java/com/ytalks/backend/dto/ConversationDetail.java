package com.ytalks.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.List;

/**
 * Full conversation with messages for detail view.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ConversationDetail(
        Long id,
        String title,
        String providerId,
        String model,
        Instant createdAt,
        Instant updatedAt,
        List<MessageSummary> messages
) {
}