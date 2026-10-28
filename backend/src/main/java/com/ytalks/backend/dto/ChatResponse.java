package com.ytalks.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Response from a chat message sent to an AI provider.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ChatResponse(
        String messageId,
        String content,
        String providerId,
        String model,
        long latencyMs
) {
}