package com.ytalks.backend.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.Map;

/**
 * JWT token generation and validation service.
 * <p>
 * Uses a secret key from configuration (environment variable).
 * Tokens contain the user ID as subject and expire after a configurable duration.
 */
@Service
public class JwtService {

    private static final Logger log = LoggerFactory.getLogger(JwtService.class);

    @Value("${ytalks.jwt.secret:change-me-in-production-use-a-long-random-string}")
    private String secretString;

    @Value("${ytalks.jwt.expiration-ms:86400000}") // 24 hours default
    private long expirationMs;

    private SecretKey secretKey;

    @PostConstruct
    void init() {
        if (secretString.length() < 32) {
            log.warn("JWT secret is shorter than 32 characters; this is insecure for production");
        }
        this.secretKey = Keys.hmacShaKeyFor(secretString.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Generates a JWT token for a user ID.
     */
    public String generateToken(Long userId) {
        Instant now = Instant.now();
        Instant expiry = now.plusMillis(expirationMs);
        return Jwts.builder()
                .subject(userId.toString())
                .issuedAt(Date.from(now))
                .expiration(Date.from(expiry))
                .signWith(secretKey)
                .compact();
    }

    /**
     * Extracts the user ID from a token.
     * Returns null if the token is invalid or expired.
     */
    public Long extractUserId(String token) {
        try {
            Claims claims = parseClaims(token);
            return Long.valueOf(claims.getSubject());
        } catch (JwtException | NumberFormatException e) {
            log.debug("Failed to extract user ID from token: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Validates a token and returns whether it's valid and not expired.
     */
    public boolean isTokenValid(String token) {
        try {
            parseClaims(token);
            return true;
        } catch (JwtException e) {
            log.debug("Invalid JWT token: {}", e.getMessage());
            return false;
        }
    }

    /**
     * Parses claims from a token.
     * Throws JwtException if token is invalid, expired, or malformed.
     */
    private Claims parseClaims(String token) {
        return Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    /**
     * Returns the expiration time in milliseconds.
     */
    public long getExpirationMs() {
        return expirationMs;
    }
}