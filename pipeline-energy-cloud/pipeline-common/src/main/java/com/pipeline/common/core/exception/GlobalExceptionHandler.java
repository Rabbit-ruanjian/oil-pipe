package com.pipeline.common.core.exception;

import java.util.List;
import java.util.stream.Collectors;

import org.springframework.http.HttpStatus;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.BindException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.NoHandlerFoundException;

import com.pipeline.common.core.domain.Result;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import lombok.extern.slf4j.Slf4j;

/**
 * 全局异常处理器
 * <p>
 * 统一处理各类异常，返回标准化的错误响应。
 * 遵循阿里巴巴Java开发手册规范。
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /**
     * 错误码：参数校验失败
     */
    private static final int CODE_PARAM_ERROR = 400;

    /**
     * 错误码：资源未找到
     */
    private static final int CODE_NOT_FOUND = 404;

    /**
     * 错误码：方法不允许
     */
    private static final int CODE_METHOD_NOT_ALLOWED = 405;

    // ==================== 业务异常处理 ====================

    /**
     * 处理业务异常
     *
     * @param e       业务异常
     * @param request HTTP请求
     * @return 错误响应
     */
    @ExceptionHandler(BusinessException.class)
    public Result<?> handleBusinessException(BusinessException e, HttpServletRequest request) {
        String uri = request.getRequestURI();
        log.warn("请求地址'{}', 发生业务异常: {}", uri, e.getMessage());
        return Result.fail(e.getCode(), e.getMessage());
    }

    // ==================== 参数校验异常处理 ====================

    /**
     * 处理 @Valid 校验失败异常（RequestBody参数）
     *
     * @param e       异常
     * @param request HTTP请求
     * @return 错误响应
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<?> handleMethodArgumentNotValidException(
            MethodArgumentNotValidException e, HttpServletRequest request) {
        String uri = request.getRequestURI();
        String message = extractValidationMessage(e.getBindingResult().getFieldErrors());
        log.warn("请求地址'{}', 参数校验失败: {}", uri, message);
        return Result.fail(CODE_PARAM_ERROR, message);
    }

    /**
     * 处理 @Validated 校验失败异常（表单参数）
     *
     * @param e       异常
     * @param request HTTP请求
     * @return 错误响应
     */
    @ExceptionHandler(BindException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<?> handleBindException(BindException e, HttpServletRequest request) {
        String uri = request.getRequestURI();
        String message = extractValidationMessage(e.getBindingResult().getFieldErrors());
        log.warn("请求地址'{}', 参数绑定失败: {}", uri, message);
        return Result.fail(CODE_PARAM_ERROR, message);
    }

    /**
     * 处理单个参数校验失败异常
     *
     * @param e       异常
     * @param request HTTP请求
     * @return 错误响应
     */
    @ExceptionHandler(ConstraintViolationException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<?> handleConstraintViolationException(
            ConstraintViolationException e, HttpServletRequest request) {
        String uri = request.getRequestURI();
        String message = e.getConstraintViolations().stream()
                .map(ConstraintViolation::getMessage)
                .collect(Collectors.joining(", "));
        log.warn("请求地址'{}', 约束校验失败: {}", uri, message);
        return Result.fail(CODE_PARAM_ERROR, message);
    }

    /**
     * 处理缺少必需参数异常
     *
     * @param e       异常
     * @param request HTTP请求
     * @return 错误响应
     */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<?> handleMissingServletRequestParameterException(
            MissingServletRequestParameterException e, HttpServletRequest request) {
        String uri = request.getRequestURI();
        String message = String.format("缺少必需参数: %s", e.getParameterName());
        log.warn("请求地址'{}', {}", uri, message);
        return Result.fail(CODE_PARAM_ERROR, message);
    }

    /**
     * 处理参数类型不匹配异常
     *
     * @param e       异常
     * @param request HTTP请求
     * @return 错误响应
     */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<?> handleMethodArgumentTypeMismatchException(
            MethodArgumentTypeMismatchException e, HttpServletRequest request) {
        String uri = request.getRequestURI();
        String message = String.format("参数'%s'类型错误，期望类型: %s",
                e.getName(), e.getRequiredType() != null ? e.getRequiredType().getSimpleName() : "未知");
        log.warn("请求地址'{}', {}", uri, message);
        return Result.fail(CODE_PARAM_ERROR, message);
    }

    /**
     * 处理请求体解析异常
     *
     * @param e       异常
     * @param request HTTP请求
     * @return 错误响应
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<?> handleHttpMessageNotReadableException(
            HttpMessageNotReadableException e, HttpServletRequest request) {
        String uri = request.getRequestURI();
        log.warn("请求地址'{}', 请求体解析失败: {}", uri, e.getMessage());
        return Result.fail(CODE_PARAM_ERROR, "请求体格式错误，请检查JSON格式");
    }

    // ==================== HTTP异常处理 ====================

    /**
     * 处理请求方法不支持异常
     *
     * @param e       异常
     * @param request HTTP请求
     * @return 错误响应
     */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    @ResponseStatus(HttpStatus.METHOD_NOT_ALLOWED)
    public Result<?> handleHttpRequestMethodNotSupportedException(
            HttpRequestMethodNotSupportedException e, HttpServletRequest request) {
        String uri = request.getRequestURI();
        String[] methods = e.getSupportedMethods();
        String supported = methods != null ? String.join(", ", methods) : "N/A";
        String message = String.format("不支持'%s'请求方法，支持的方法: %s",
                e.getMethod(), supported);
        log.warn("请求地址'{}', {}", uri, message);
        return Result.fail(CODE_METHOD_NOT_ALLOWED, message);
    }

    /**
     * 处理404异常
     *
     * @param e       异常
     * @param request HTTP请求
     * @return 错误响应
     */
    @ExceptionHandler(NoHandlerFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public Result<?> handleNoHandlerFoundException(
            NoHandlerFoundException e, HttpServletRequest request) {
        String uri = request.getRequestURI();
        log.warn("请求地址'{}', 资源不存在", uri);
        return Result.fail(CODE_NOT_FOUND, "请求的资源不存在");
    }

    // ==================== 兜底异常处理 ====================

    /**
     * 处理未知运行时异常
     *
     * @param e       异常
     * @param request HTTP请求
     * @return 错误响应
     */
    @ExceptionHandler(RuntimeException.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public Result<?> handleRuntimeException(RuntimeException e, HttpServletRequest request) {
        String uri = request.getRequestURI();
        log.error("请求地址'{}', 发生未知运行时异常", uri, e);
        return Result.fail("系统繁忙，请稍后重试");
    }

    /**
     * 处理所有未捕获的异常
     *
     * @param e       异常
     * @param request HTTP请求
     * @return 错误响应
     */
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public Result<?> handleException(Exception e, HttpServletRequest request) {
        String uri = request.getRequestURI();
        log.error("请求地址'{}', 发生系统异常", uri, e);
        return Result.fail("系统异常，请联系管理员");
    }

    // ==================== 辅助方法 ====================

    /**
     * 提取校验错误信息
     *
     * @param fieldErrors 字段错误列表
     * @return 格式化的错误信息
     */
    private String extractValidationMessage(List<FieldError> fieldErrors) {
        if (fieldErrors == null || fieldErrors.isEmpty()) {
            return "参数校验失败";
        }
        return fieldErrors.stream()
                .map(error -> String.format("%s: %s", error.getField(), error.getDefaultMessage()))
                .collect(Collectors.joining("; "));
    }
}
