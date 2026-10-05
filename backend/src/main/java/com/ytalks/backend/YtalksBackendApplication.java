package com.ytalks.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * Entry point for the Ytalks application layer.
 *
 * <p>Milestone 2 deliberately contains no persistence, authentication or AI
 * provider integration. It establishes the REST/JSON foundation the frontend
 * talks to and the conventions every later milestone will follow.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class YtalksBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(YtalksBackendApplication.class, args);
    }
}
