package com.ytalks.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Request to send a chat message to an AI provider.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ChatRequest(
        @NotBlank @Size(max = 10000) String message,
        @Size(max = 50) String providerId,
        @Size(max = 50) String model
) {
}