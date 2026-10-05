package com.ytalks.backend.dto;

import java.time.Instant;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Response of {@code GET /api/health}.
 *
 * <p>Deliberately small and free of internal detail: enough for the frontend to
 * prove the round trip and show a connection badge, nothing about the host,
 * classpath or configuration.
 *
 * @param status always {@code UP} when the request reaches this service
 * @param service human readable service name
 * @param version application version from the build
 * @param environment active Spring profile
 * @param checks individual subsystem results
 * @param serverTime when the response was produced, ISO-8601 UTC
 * @param responseTimeMs how long the health check itself took
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record HealthResponse(
        String status,
        String service,
        String version,
        String environment,
        List<Check> checks,
        Instant serverTime,
        long responseTimeMs) {

    /**
     * One named dependency check.
     *
     * @param name what was checked
     * @param status {@code UP} or {@code DEGRADED}
     * @param detail short, non-sensitive explanation
     */
    public record Check(String name, String status, String detail) {
    }
}
