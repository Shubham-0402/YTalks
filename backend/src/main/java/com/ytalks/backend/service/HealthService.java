package com.ytalks.backend.service;

import java.time.Instant;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

import com.ytalks.backend.dto.HealthResponse;

/**
 * Builds the health payload.
 *
 * <p>All logic that a controller should not contain lives here, so the same
 * information can later be produced by an actuator endpoint, a readiness probe
 * or a CLI without touching the web layer.
 */
@Service
public class HealthService {

    private final Environment environment;
    private final String version;

    public HealthService(Environment environment, @Value("${app.version:0.0.0}") String version) {
        this.environment = environment;
        this.version = version;
    }

    /**
     * Assembles the health report.
     *
     * @return status, service identity and the individual checks that ran
     */
    public HealthResponse currentHealth() {
        long startedAt = System.nanoTime();
        return new HealthResponse(
                "UP",
                "Ytalks backend",
                version,
                activeProfile(),
                List.of(
                        new HealthResponse.Check("api", "UP", "REST endpoints are served"),
                        new HealthResponse.Check("persistence", "NOT_CONFIGURED",
                                "no database is configured in this milestone")),
                Instant.now(),
                elapsedMillis(startedAt));
    }

    private String activeProfile() {
        String[] active = environment.getActiveProfiles();
        return active.length == 0 ? "default" : String.join(",", active);
    }

    private long elapsedMillis(long startedAtNanos) {
        return Math.max(0, (System.nanoTime() - startedAtNanos) / 1_000_000);
    }
}
