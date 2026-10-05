package com.ytalks.backend.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(properties = "ytalks.cors.allowed-origins=https://app.example.test,https://admin.example.test")
class CorsPropertiesTest {

    @Autowired
    private CorsProperties corsProperties;

    @Test
    @DisplayName("the origin list is configuration, not code: overriding it changes behaviour")
    void originsComeFromConfiguration() {
        assertThat(corsProperties.allowedOrigins())
                .containsExactly("https://app.example.test", "https://admin.example.test");
    }

    @Test
    @DisplayName("credentials stay off unless explicitly enabled")
    void credentialsAreOptIn() {
        assertThat(corsProperties.allowCredentials()).isFalse();
    }
}
