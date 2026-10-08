package com.pipeline.auth.controller;

import com.pipeline.auth.domain.LoginBody;
import com.pipeline.auth.service.TokenService;
import com.pipeline.common.core.domain.Result;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 认证控制器
 */
@RestController
@RequestMapping("/auth")
public class AuthController {

    @Autowired
    private TokenService tokenService;

    /**
     * 登录方法
     */
    @PostMapping("/login")
    public Result<Map<String, Object>> login(@RequestBody LoginBody loginBody) {
        try {
            Map<String, Object> token = tokenService.login(loginBody);
            return Result.ok(token);
        } catch (Exception e) {
            return Result.fail(e.getMessage());
        }
    }
}
