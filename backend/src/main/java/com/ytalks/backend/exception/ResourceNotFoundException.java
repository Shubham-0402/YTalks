package com.ytalks.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * A requested resource does not exist.
 *
 * <p>Placeholder for the endpoints added in later milestones (conversations,
 * messages, providers). Nothing throws it yet, which is why there is no test for
 * it yet either.
 */
public class ResourceNotFoundException extends ApiException {

    public ResourceNotFoundException(String resource, String id) {
        super(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", resource + " '" + id + "' was not found");
    }
}
