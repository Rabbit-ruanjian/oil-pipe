package com.pipeline.data.controller;

import com.pipeline.common.core.domain.Result;
import com.pipeline.data.domain.Project;
import com.pipeline.data.service.IProjectService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 项目管理控制器
 */
@RestController
@RequestMapping("/project")
public class ProjectController {

    @Autowired
    private IProjectService projectService;

    /**
     * 查询项目列表
     */
    @GetMapping("/list")
    public Result<List<Project>> list() {
        return Result.ok(projectService.list());
    }

    /**
     * 获取项目详细信息
     */
    @GetMapping(value = "/{proId}")
    public Result<Project> getInfo(@PathVariable("proId") Long proId) {
        return Result.ok(projectService.getById(proId));
    }

    /**
     * 新增项目
     */
    @PostMapping
    public Result<Boolean> add(@RequestBody Project project) {
        return Result.ok(projectService.save(project));
    }

    /**
     * 修改项目
     */
    @PutMapping
    public Result<Boolean> edit(@RequestBody Project project) {
        return Result.ok(projectService.updateById(project));
    }

    /**
     * 删除项目
     */
    @DeleteMapping("/{proIds}")
    public Result<Boolean> remove(@PathVariable List<Long> proIds) {
        return Result.ok(projectService.removeProjectsCascade(proIds));
    }
}
