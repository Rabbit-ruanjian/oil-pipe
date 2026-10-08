package com.pipeline.common.core.exception;

import java.io.Serial;

import lombok.Getter;

/**
 * 业务异常类
 * <p>
 * 用于在业务逻辑中抛出的可预期异常，
 * 会被全局异常处理器捕获并返回友好的错误信息。
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Getter
public class BusinessException extends RuntimeException {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 错误码
     */
    private final int code;

    /**
     * 错误消息
     */
    private final String message;

    /**
     * 构造业务异常（使用默认错误码500）
     *
     * @param message 错误消息
     */
    public BusinessException(String message) {
        super(message);
        this.code = 500;
        this.message = message;
    }

    /**
     * 构造业务异常
     *
     * @param code    错误码
     * @param message 错误消息
     */
    public BusinessException(int code, String message) {
        super(message);
        this.code = code;
        this.message = message;
    }

    /**
     * 构造业务异常（带原因）
     *
     * @param message 错误消息
     * @param cause   原因
     */
    public BusinessException(String message, Throwable cause) {
        super(message, cause);
        this.code = 500;
        this.message = message;
    }

    /**
     * 构造业务异常（带原因和错误码）
     *
     * @param code    错误码
     * @param message 错误消息
     * @param cause   原因
     */
    public BusinessException(int code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
        this.message = message;
    }

    /**
     * 快速创建业务异常
     *
     * @param message 错误消息
     * @return 业务异常
     */
    public static BusinessException of(String message) {
        return new BusinessException(message);
    }

    /**
     * 快速创建业务异常
     *
     * @param code    错误码
     * @param message 错误消息
     * @return 业务异常
     */
    public static BusinessException of(int code, String message) {
        return new BusinessException(code, message);
    }
}
