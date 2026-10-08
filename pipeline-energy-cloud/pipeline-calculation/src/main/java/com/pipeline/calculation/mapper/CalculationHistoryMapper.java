package com.pipeline.calculation.mapper;

import java.time.LocalDateTime;
import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.pipeline.calculation.domain.entity.CalculationHistory;

/**
 * 计算历史记录 Mapper 接口
 * <p>
 * SQL 列名对齐 t_calculation_history (upgrade_v1.1.0.sql)
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Mapper
public interface CalculationHistoryMapper extends BaseMapper<CalculationHistory> {

    @Select("SELECT COUNT(*) FROM t_calculation_history WHERE calc_type = #{calcType}")
    long countByCalcType(@Param("calcType") String calcType);

    @Select("SELECT COUNT(*) FROM t_calculation_history WHERE create_by = #{createBy}")
    long countByCreateBy(@Param("createBy") String createBy);

    @Select("SELECT COUNT(*) FROM t_calculation_history WHERE pro_id = #{proId}")
    long countByProId(@Param("proId") Long proId);

    @Select("SELECT * FROM t_calculation_history WHERE create_by = #{createBy} " +
            "ORDER BY create_time DESC LIMIT #{limit}")
    List<CalculationHistory> selectRecentByCreateBy(@Param("createBy") String createBy, @Param("limit") int limit);

    @Select("SELECT * FROM t_calculation_history WHERE pro_id = #{proId} " +
            "ORDER BY create_time DESC")
    IPage<CalculationHistory> selectPageByProId(Page<CalculationHistory> page,
                                                 @Param("proId") Long proId);

    @Select("SELECT COUNT(*) FROM t_calculation_history " +
            "WHERE create_time BETWEEN #{startTime} AND #{endTime}")
    long countByTimeRange(@Param("startTime") LocalDateTime startTime,
                          @Param("endTime") LocalDateTime endTime);

    @Select("SELECT COUNT(*) FROM t_calculation_history " +
            "WHERE calc_type = #{calcType} AND create_time BETWEEN #{startTime} AND #{endTime}")
    long countByCalcTypeAndTimeRange(@Param("calcType") String calcType,
                                     @Param("startTime") LocalDateTime startTime,
                                     @Param("endTime") LocalDateTime endTime);

    @Select("SELECT COUNT(DISTINCT create_by) FROM t_calculation_history " +
            "WHERE create_time BETWEEN #{startTime} AND #{endTime} AND create_by IS NOT NULL")
    long countDistinctCreateByInRange(@Param("startTime") LocalDateTime startTime,
                                      @Param("endTime") LocalDateTime endTime);

    @Select("SELECT COUNT(DISTINCT pro_id) FROM t_calculation_history " +
            "WHERE create_time BETWEEN #{startTime} AND #{endTime} AND pro_id IS NOT NULL")
    long countDistinctProjectInRange(@Param("startTime") LocalDateTime startTime,
                                     @Param("endTime") LocalDateTime endTime);
}
