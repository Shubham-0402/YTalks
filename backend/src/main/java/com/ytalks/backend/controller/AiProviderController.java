package com.ytalks.backend.controller;

import com.ytalks.backend.dto.AiProviderResponse;
import com.ytalks.backend.service.AiProviderService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.stream.Collectors;

/**
 * REST endpoint for retrieving available AI providers.
 * <p>
 * Returns the provider records seeded at startup. No API keys or secrets
 * are exposed — this is purely metadata for the frontend to build the
 * provider selection UI.
 */
@RestController
@RequestMapping("/api/providers")
public class AiProviderController {

    private final AiProviderService providerService;

    public AiProviderController(AiProviderService providerService) {
        this.providerService = providerService;
    }

    /**
     * Returns all enabled AI providers.
     * <p>
     * The frontend uses this to populate the provider/model selector.
     */
    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public List<AiProviderResponse> getEnabledProviders() {
        return providerService.getEnabledProviders().stream()
                .map(p -> new AiProviderResponse(
                        p.getId(),
                        p.getProviderName(),
                        p.getProviderType(),
                        p.isEnabled()))
                .collect(Collectors.toList());
    }
}