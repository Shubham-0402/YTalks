package com.ytalks.backend.exception;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Test-only probe that gives the Bean Validation starter something real to do.
 *
 * <p>It exists purely so {@link GlobalExceptionHandler} can be tested for field
 * level validation failures. It is not part of the shipped API: there is no
 * reason for a health-check milestone to expose an echo endpoint.
 */
@RestController
@RequestMapping("/__test")
class ValidationProbeController {

    @PostMapping("/echo")
    String echo(@Valid @RequestBody ProbeRequest request) {
        return request.message();
    }

    record ProbeRequest(
            @NotBlank(message = "message must not be blank")
            @Size(max = 10, message = "message must be 10 characters or fewer")
            String message) {
    }
}
