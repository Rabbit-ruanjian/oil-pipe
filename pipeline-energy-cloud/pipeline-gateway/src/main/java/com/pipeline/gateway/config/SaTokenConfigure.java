package com.pipeline.gateway.config;

import cn.dev33.satoken.reactor.filter.SaReactorFilter;
import cn.dev33.satoken.router.SaRouter;
import cn.dev33.satoken.stp.StpUtil;
import cn.dev33.satoken.util.SaResult;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Sa-Token 权限认证配置
 */
@Configuration
public class SaTokenConfigure {

    @Bean
    public SaReactorFilter getSaReactorFilter() {
        return new SaReactorFilter()
            // 拦截地址
            .addInclude("/**")
            // 开放地址
            .addExclude("/favicon.ico")
            .addExclude("/auth/**") // 认证服务不需要拦截
            // 鉴权方法：每次请求进入 Controller 之前，该方法都会被调用
            .setAuth(obj -> {
                // 登录校验 -- 拦截所有路由，并排除/auth/** 用于登录，其他都需登录
                SaRouter.match("/**", "/auth/**", r -> StpUtil.checkLogin());
                
                // 权限认证 -- 不同模块, 校验不同权限
                // SaRouter.match("/user/**", r -> StpUtil.checkPermission("user"));
                // SaRouter.match("/admin/**", r -> StpUtil.checkPermission("admin"));
            })
            // 异常处理方法：每次 setAuth 函数出现异常时，该方法都会被调用
            .setError(e -> {
                return SaResult.error(e.getMessage());
            });
    }
}
