package com.ytalks.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Request to register a new user.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record RegisterRequest(
        @NotBlank @Size(min = 2, max = 120) String name,
        @NotBlank @Email @Size(max = 255) String email,
        @Size(max = 30) String phone,
        @NotBlank @Size(min = 8, max = 128) String password
) {
}