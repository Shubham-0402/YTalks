package com.ytalks.backend.repository;

import com.ytalks.backend.entity.Message;
import com.ytalks.backend.entity.Conversation;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Repository for {@link Message} entities.
 */
@Repository
public interface MessageRepository extends JpaRepository<Message, Long> {

    /**
     * Finds all messages for a conversation, ordered by creation time ascending.
     */
    List<Message> findByConversationOrderByCreatedAtAsc(Conversation conversation);

    /**
     * Finds all messages for a conversation with pagination.
     */
    Page<Message> findByConversationOrderByCreatedAtAsc(Conversation conversation, Pageable pageable);

    /**
     * Counts messages in a conversation.
     */
    long countByConversation(Conversation conversation);

    /**
     * Finds the most recent message in a conversation.
     */
    @Query("SELECT m FROM Message m WHERE m.conversation = :conversation ORDER BY m.createdAt DESC")
    Message findFirstByConversationOrderByCreatedAtDesc(Conversation conversation);
}