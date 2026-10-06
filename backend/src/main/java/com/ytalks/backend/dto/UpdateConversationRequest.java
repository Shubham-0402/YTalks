package com.ytalks.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Request to update a conversation.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record UpdateConversationRequest(
        String title,
        String providerId,
        String model
) {
}