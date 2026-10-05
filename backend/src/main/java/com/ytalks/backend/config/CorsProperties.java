package com.ytalks.backend.config;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Externalised configuration for the HTTP layer.
 *
 * <p>Values come from {@code application.yml} and can be overridden with
 * environment variables, e.g. {@code YTALKS_CORS_ALLOWED_ORIGINS=http://localhost:5173}.
 * Origins are never hard-coded in Java so the production list can be supplied
 * per deployment without a rebuild.
 *
 * @param allowedOrigins frontend origins permitted to call this API
 * @param allowCredentials whether cookies/authorisation headers may be sent
 */
@ConfigurationProperties(prefix = "ytalks.cors")
public record CorsProperties(List<String> allowedOrigins, boolean allowCredentials) {

    public CorsProperties {
        allowedOrigins = allowedOrigins == null ? List.of() : List.copyOf(allowedOrigins);
    }
}
