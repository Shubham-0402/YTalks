package com.ytalks.backend.controller;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import com.ytalks.backend.config.ApiRequestContextFilter;

import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.matchesPattern;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class HealthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    @DisplayName("GET /api/health answers 200 with a JSON payload the frontend can render")
    void healthReportsUp() throws Exception {
        mockMvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("application/json"))
                .andExpect(jsonPath("$.status", is("UP")))
                .andExpect(jsonPath("$.service", is("Ytalks backend")))
                .andExpect(jsonPath("$.version", is("0.2.0")))
                .andExpect(jsonPath("$.environment", is("default")))
                .andExpect(jsonPath("$.serverTime", matchesPattern(".+")))
                .andExpect(jsonPath("$.responseTimeMs", greaterThanOrEqualTo(0)))
                .andExpect(jsonPath("$.checks", hasSize(2)))
                .andExpect(jsonPath("$.checks[0].name", is("api")))
                .andExpect(jsonPath("$.checks[0].status", is("UP")));
    }

    @Test
    @DisplayName("every response carries a correlation id for log tracing")
    void healthReturnsRequestId() throws Exception {
        mockMvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(header().exists(ApiRequestContextFilter.HEADER));
    }

    @Test
    @DisplayName("a client-supplied correlation id is echoed back")
    void healthEchoesClientRequestId() throws Exception {
        mockMvc.perform(get("/api/health").header(ApiRequestContextFilter.HEADER, "browser-abc-123"))
                .andExpect(status().isOk())
                .andExpect(header().string(ApiRequestContextFilter.HEADER, "browser-abc-123"));
    }

    @Test
    @DisplayName("the health payload never leaks host, path or environment detail")
    void healthStaysOpaque() throws Exception {
        String body = mockMvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        org.assertj.core.api.Assertions.assertThat(body)
                .doesNotContain("java.home")
                .doesNotContain("classpath")
                .doesNotContain(System.getProperty("user.name"))
                .doesNotContain("Exception");
    }
}
