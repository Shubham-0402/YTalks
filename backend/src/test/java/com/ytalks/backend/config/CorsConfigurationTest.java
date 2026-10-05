package com.ytalks.backend.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The frontend runs on its own static server, so every browser call is
 * cross-origin. These tests pin the behaviour: configured origins are allowed,
 * everything else is refused, and no wildcard is ever emitted.
 */
@SpringBootTest
@AutoConfigureMockMvc
class CorsConfigurationTest {

    private static final String ALLOWED = "http://localhost:4173";

    @Autowired
    private MockMvc mockMvc;

    @Test
    @DisplayName("a configured origin gets an explicit allow header back")
    void allowedOriginIsEchoed() throws Exception {
        mockMvc.perform(get("/api/health").header("Origin", ALLOWED))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", ALLOWED))
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin_"));
    }

    @Test
    @DisplayName("the smoke-test server origin is allowed by default too")
    void smokeTestOriginIsAllowed() throws Exception {
        mockMvc.perform(get("/api/health").header("Origin", "http://127.0.0.1:4319"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://127.0.0.1:4319"));
    }

    @Test
    @DisplayName("an unknown origin is refused outright, not merely un-answered")
    void unknownOriginIsRefused() throws Exception {
        mockMvc.perform(get("/api/health").header("Origin", "http://not-ytalks.example"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    @Test
    @DisplayName("preflight for the frontend origin succeeds")
    void preflightSucceeds() throws Exception {
        mockMvc.perform(options("/api/health")
                        .header("Origin", ALLOWED)
                        .header("Access-Control-Request-Method", "GET")
                        .header("Access-Control-Request-Headers", "content-type"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", ALLOWED))
                .andExpect(header().string("Access-Control-Allow-Methods", org.hamcrest.Matchers.containsString("GET")));
    }
}
