package com.ytalks.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Request to add a message.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AddMessageRequest(
        String senderType,
        String content,
        String providerId,
        String model
) {
}