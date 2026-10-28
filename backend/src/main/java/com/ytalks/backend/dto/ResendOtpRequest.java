package com.ytalks.backend.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/**
 * Request to resend an OTP code.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ResendOtpRequest(
        @NotBlank @Email String email
) {
}