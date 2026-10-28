package com.ytalks.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Request to log in.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record LoginRequest(
        @NotBlank @Size(max = 255) String email,
        @NotBlank @Size(min = 8, max = 128) String password
) {
}