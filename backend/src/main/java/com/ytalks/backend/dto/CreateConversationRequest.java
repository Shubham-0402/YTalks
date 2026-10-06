package com.ytalks.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Request to create a new conversation.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record CreateConversationRequest(
        String title,
        String providerId,
        String model
) {
}