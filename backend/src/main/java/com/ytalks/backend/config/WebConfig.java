package com.ytalks.backend.config;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * CORS for local development.
 *
 * <p>The Vite-less Milestone 1 frontend is served from its own static server, so
 * the browser treats it as a different origin from the API. Only the configured
 * origins are accepted — there is no wildcard — and the resolved origin is
 * echoed back, which {@code allowCredentials} requires.
 *
 * <p>The defaults live in {@code application.yml}; supply a different list with
 * {@code YTALKS_CORS_ALLOWED_ORIGINS} (comma separated).
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private static final Logger log = LoggerFactory.getLogger(WebConfig.class);

    private final CorsProperties corsProperties;

    public WebConfig(CorsProperties corsProperties) {
        this.corsProperties = corsProperties;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        List<String> origins = corsProperties.allowedOrigins();
        if (origins.isEmpty()) {
            log.warn("No CORS origins configured: browser calls from a different origin will be blocked");
            return;
        }
        log.info("CORS enabled for {} origin(s): {}", origins.size(), origins);
        registry.addMapping("/api/**")
                .allowedOrigins(origins.toArray(String[]::new))
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("Content-Type", "Accept", "Authorization", "X-Requested-With")
                .exposedHeaders("Location")
                .allowCredentials(corsProperties.allowCredentials())
                .maxAge(3600);
    }
}
