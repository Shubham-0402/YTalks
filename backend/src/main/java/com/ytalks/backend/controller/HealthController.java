package com.ytalks.backend.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ytalks.backend.dto.HealthResponse;
import com.ytalks.backend.service.HealthService;

/**
 * Health endpoint used by the frontend connection badge and by any external
 * uptime check.
 *
 * <p>Returns 200 as long as the service can answer. Subsystem failures, once
 * they exist, will move to a 503 payload rather than pretending everything is
 * fine.
 */
@RestController
@RequestMapping("/api/health")
public class HealthController {

    private static final Logger log = LoggerFactory.getLogger(HealthController.class);

    private final HealthService healthService;

    public HealthController(HealthService healthService) {
        this.healthService = healthService;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public HealthResponse health() {
        HealthResponse response = healthService.currentHealth();
        log.debug("health: {} ({} ms)", response.status(), response.responseTimeMs());
        return response;
    }
}
