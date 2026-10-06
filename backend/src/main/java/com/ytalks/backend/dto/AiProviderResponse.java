package com.ytalks.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * AI Provider summary for the frontend.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AiProviderResponse(
        Long id,
        String providerName,
        String providerType,
        boolean enabled
) {
}