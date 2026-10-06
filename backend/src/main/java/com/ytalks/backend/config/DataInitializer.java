package com.ytalks.backend.config;

import com.ytalks.backend.entity.AiProvider;
import com.ytalks.backend.service.AiProviderService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Seeds the database with the initial AI provider records on application startup.
 * <p>
 * This runs once when the application starts and ensures the four supported
 * providers exist. It is idempotent — running multiple times does not create
 * duplicates.
 */
@Configuration
public class DataInitializer {

    private static final Logger log = LoggerFactory.getLogger(DataInitializer.class);

    @Bean
    CommandLineRunner seedAiProviders(AiProviderService providerService) {
        return args -> {
            log.info("Seeding AI provider records...");

            providerService.ensureProvider("OpenAI", "openai", true);
            providerService.ensureProvider("Google Gemini", "gemini", true);
            providerService.ensureProvider("Anthropic Claude", "claude", true);
            providerService.ensureProvider("DeepSeek", "deepseek", true);

            long count = providerService.getAllProviders().size();
            log.info("AI provider seeding complete: {} provider(s) in database", count);
        };
    }
}