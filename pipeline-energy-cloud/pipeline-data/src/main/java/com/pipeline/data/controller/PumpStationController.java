package com.pipeline.data.controller;

import com.pipeline.common.core.domain.Result;
import com.pipeline.data.domain.PumpStation;
import com.pipeline.data.service.IPumpStationService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 泵站参数管理控制器
 */
@RestController
@RequestMapping("/pump-station")
public class PumpStationController {

    @Autowired
    private IPumpStationService pumpStationService;

    /**
     * 查询泵站列表
     */
    @GetMapping("/list")
    public Result<List<PumpStation>> list() {
        return Result.ok(pumpStationService.list());
    }

    /**
     * 获取泵站详细信息
     */
    @GetMapping(value = "/{id}")
    public Result<PumpStation> getInfo(@PathVariable("id") Long id) {
        return Result.ok(pumpStationService.getById(id));
    }

    /**
     * 新增泵站
     */
    @PostMapping
    public Result<Boolean> add(@RequestBody PumpStation pumpStation) {
        return Result.ok(pumpStationService.save(pumpStation));
    }

    /**
     * 修改泵站
     */
    @PutMapping
    public Result<Boolean> edit(@RequestBody PumpStation pumpStation) {
        return Result.ok(pumpStationService.updateById(pumpStation));
    }

    /**
     * 删除泵站
     */
    @DeleteMapping("/{ids}")
    public Result<Boolean> remove(@PathVariable List<Long> ids) {
        return Result.ok(pumpStationService.removeBatchByIds(ids));
    }
}
